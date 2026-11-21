// The Quiet Gallery — a top-down stealth game.
// The thief slips through a night museum, steals three relics per level
// and reaches the exit unseen. Guards patrol waypoint loops with vision
// cones; crates and pillars block sight, tall plants hide the thief,
// shadow floor muffles detection and lamp light exposes it.
//
// Played with keyboard and mouse in desktop Chrome, no network requests:
// every sound is synthesized (see audio.js) and every sprite is drawn
// on the canvas. `?shot=<name>` poses a deterministic frame for the
// entry screenshots and sets window.__shotReady when it has rendered.

import { TILE, COLS, ROWS, LEVELS, validateLevels } from './config.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';

const W = COLS * TILE;
const H = ROWS * TILE;
const PLAYER_R = 14;
const WALK_SPEED = 185;
const SNEAK_SPEED = 85;
const NOISE_RADIUS = 130;
const COIN_RANGE = 180;
const CATCH_DIST = 26;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W;
canvas.height = H;

// Off-screen layer for the night darkness: light pools are punched
// out of it around lamps and the thief, then it is drawn over the floor.
const darkCanvas = document.createElement('canvas');
darkCanvas.width = W;
darkCanvas.height = H;
const darkCtx = darkCanvas.getContext('2d');

const $ = (id) => document.getElementById(id);
const hudLevel = $('hud-level');
const hudRelics = $('hud-relics');
const hudCoins = $('hud-coins');
const hudTime = $('hud-time');
const hudAlert = $('hud-alert-fill');
const hudObjective = $('hud-objective');
const overlayMenu = $('overlay-menu');
const overlayPause = $('overlay-pause');
const overlayWin = $('overlay-win');
const overlayLose = $('overlay-lose');
const winStats = $('win-stats');
const loseStats = $('lose-stats');
const winTitle = $('win-title');
const winNext = $('win-next');

const levelProblems = validateLevels();
if (levelProblems.length > 0) {
  console.error('level problems:', levelProblems);
}

const keys = new Set();
let screen = 'menu'; // menu | playing | paused | won | lost
let levelIndex = 0;
let grid = [];
let player = null;
let guards = [];
let relics = [];
let exitTile = null;
let lamps = [];
let coinsLeft = 5;
let coinFlight = null;
let coinsOnFloor = [];
let elapsed = 0;
let alarms = 0;
let totalAlarms = 0;
let totalTime = 0;
let ghost = true; // true while no guard has ever chased the thief
let stepTimer = 0;
let stepAlternate = false;
let noisePulse = 0;
let shotMode = null;
let lastFrame = performance.now();

function tileCenter(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function tileAtPx(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return '#';
  return grid[ty][tx];
}

function solidForMovement(ch) {
  return ch === '#' || ch === 'C' || ch === 'P';
}

function blocksSight(ch) {
  return ch === '#' || ch === 'C' || ch === 'P' || ch === 'T';
}

// Sample the segment every ~6 px; blocked when any sample lands in a
// tile that blocks sight.
function losClear(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 6));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (blocksSight(tileAtPx(x1 + dx * t, y1 + dy * t))) return false;
  }
  return true;
}

function inLampLight(x, y) {
  for (const lamp of lamps) {
    const c = tileCenter(lamp[0], lamp[1]);
    if (Math.hypot(x - c.x, y - c.y) < 78) return true;
  }
  return false;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function loadLevel(index) {
  const level = LEVELS[index];
  grid = level.map.map((row) => row.split(''));
  lamps = level.lamps;
  relics = [];
  guards = [];
  exitTile = null;
  coinsOnFloor = [];
  coinFlight = null;
  coinsLeft = 5;
  elapsed = 0;
  alarms = 0;
  ghost = true;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = grid[r][c];
      if (ch === 'p') {
        const s = tileCenter(c, r);
        player = { x: s.x, y: s.y, facing: 0, sneaking: false, moving: false };
      } else if (ch === 'R') {
        const s = tileCenter(c, r);
        relics.push({ x: s.x, y: s.y, taken: false, hue: relics.length });
      } else if (ch === 'E') {
        exitTile = tileCenter(c, r);
      }
    }
  }
  for (const g of level.guards) {
    const s = tileCenter(g.x, g.y);
    guards.push({
      x: s.x,
      y: s.y,
      facing: 0,
      waypoints: g.waypoints.map(([wx, wy]) => tileCenter(wx, wy)),
      wpIndex: 1 % g.waypoints.length,
      speed: g.speed,
      range: g.range,
      fov: g.fov,
      state: 'patrol', // patrol | suspicious | chase | investigate
      suspicion: 0,
      lastSeen: null,
      lostTimer: 0,
      waitTimer: 0,
      wasSuspicious: false,
    });
  }
  hudLevel.textContent = level.name;
  hudObjective.textContent = level.intro;
}

function relicsLeft() {
  return relics.filter((r) => !r.taken).length;
}

function exitOpen() {
  return relicsLeft() === 0;
}

function showOnly(overlay) {
  for (const el of [overlayMenu, overlayPause, overlayWin, overlayLose]) {
    el.classList.toggle('hidden', el !== overlay);
  }
}

function startLevel(index) {
  levelIndex = index;
  loadLevel(index);
  screen = 'playing';
  showOnly(null);
  updateHud();
}

function startGame() {
  unlockAudio();
  totalAlarms = 0;
  totalTime = 0;
  startLevel(0);
}

function pauseGame() {
  if (screen !== 'playing') return;
  screen = 'paused';
  showOnly(overlayPause);
}

function resumeGame() {
  if (screen !== 'paused') return;
  screen = 'playing';
  showOnly(null);
}

function winLevel() {
  totalTime += elapsed;
  totalAlarms += alarms;
  sfx.win();
  const last = levelIndex >= LEVELS.length - 1;
  screen = 'won';
  winTitle.textContent = last ? 'The Gallery Is Yours' : 'Clean Getaway';
  winStats.textContent = last
    ? `All three wings cleared in ${formatTime(totalTime)} · alarms raised: ${totalAlarms}${totalAlarms === 0 ? ' · GHOST — never once chased' : ''}`
    : `${LEVELS[levelIndex].name} cleared in ${formatTime(elapsed)} · alarms raised: ${alarms}${alarms === 0 ? ' · GHOST — never chased' : ''}`;
  winNext.textContent = last ? 'Play again' : 'Next level';
  showOnly(overlayWin);
  updateHud();
}

function loseGame(reason) {
  totalTime += elapsed;
  totalAlarms += alarms;
  sfx.lose();
  screen = 'lost';
  loseStats.textContent = `${reason} · ${LEVELS[levelIndex].name} · ${formatTime(elapsed)} · relics stolen: ${3 - relicsLeft()} of 3`;
  showOnly(overlayLose);
  updateHud();
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateHud() {
  hudRelics.textContent = `◆ ${3 - relicsLeft()}/3`;
  hudCoins.textContent = `◉ ${coinsLeft}`;
  hudTime.textContent = formatTime(elapsed);
  const worst = guards.reduce((m, g) => Math.max(m, g.suspicion), 0);
  hudAlert.style.width = `${Math.round(worst * 100)}%`;
  hudAlert.style.background = worst >= 1 ? '#e5484d' : worst >= 0.5 ? '#f5a524' : '#7dd87d';
  if (screen === 'playing') {
    hudObjective.textContent = exitOpen()
      ? 'All relics stolen — reach the glowing exit!'
      : `${LEVELS[levelIndex].intro} Relics left: ${relicsLeft()}.`;
  }
}

// ---- movement with tile collision (circle vs solid tiles) ----
function moveCircle(entity, dx, dy, radius) {
  const nx = entity.x + dx;
  if (!hitsSolid(nx, entity.y, radius)) entity.x = nx;
  const ny = entity.y + dy;
  if (!hitsSolid(entity.x, ny, radius)) entity.y = ny;
}

function hitsSolid(x, y, radius) {
  const x0 = Math.floor((x - radius) / TILE);
  const x1 = Math.floor((x + radius) / TILE);
  const y0 = Math.floor((y - radius) / TILE);
  const y1 = Math.floor((y + radius) / TILE);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      const ch = tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? '#' : grid[ty][tx];
      if (!solidForMovement(ch)) continue;
      const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if (Math.hypot(x - cx, y - cy) < radius) return true;
    }
  }
  return false;
}

// ---- guard senses ----
function detectionRate(guard) {
  const d = Math.hypot(player.x - guard.x, player.y - guard.y);
  if (d > guard.range) return 0;
  const toPlayer = Math.atan2(player.y - guard.y, player.x - guard.x);
  if (Math.abs(angleDiff(toPlayer, guard.facing)) > guard.fov) return 0;
  if (!losClear(guard.x, guard.y, player.x, player.y)) return 0;
  let rate = 0.9 * (1.6 - d / guard.range);
  rate *= player.sneaking ? 0.5 : 1.35;
  if (tileAtPx(player.x, player.y) === 'S') rate *= 0.45;
  if (inLampLight(player.x, player.y)) rate *= 1.5;
  return rate;
}

function guardInvestigate(guard, x, y) {
  if (guard.state === 'chase') return;
  guard.state = 'investigate';
  guard.lastSeen = { x, y };
  guard.waitTimer = 0;
}

function updateGuard(guard, dt) {
  const d = Math.hypot(player.x - guard.x, player.y - guard.y);
  const rate = detectionRate(guard);
  if (rate > 0) {
    guard.suspicion = Math.min(1, guard.suspicion + rate * dt);
    guard.lastSeen = { x: player.x, y: player.y };
    guard.lostTimer = 0;
  } else {
    guard.suspicion = Math.max(0, guard.suspicion - 0.35 * dt);
    if (guard.state === 'chase') guard.lostTimer += dt;
  }

  if (guard.suspicion >= 1 && guard.state !== 'chase') {
    guard.state = 'chase';
    alarms += 1;
    ghost = false;
    sfx.alert();
  } else if (guard.suspicion >= 0.5 && guard.state === 'patrol') {
    guard.state = 'suspicious';
    if (!guard.wasSuspicious) sfx.suspicious();
    guard.wasSuspicious = true;
  } else if (guard.suspicion < 0.5 && guard.state === 'suspicious') {
    guard.state = 'patrol';
    guard.wasSuspicious = false;
  }

  if (guard.state === 'patrol') {
    const target = guard.waypoints[guard.wpIndex];
    const dist = Math.hypot(target.x - guard.x, target.y - guard.y);
    if (dist < 6) {
      guard.wpIndex = (guard.wpIndex + 1) % guard.waypoints.length;
    } else {
      const want = Math.atan2(target.y - guard.y, target.x - guard.x);
      guard.facing = turnToward(guard.facing, want, dt * 6);
      moveCircle(guard, Math.cos(guard.facing) * guard.speed * dt, Math.sin(guard.facing) * guard.speed * dt, 13);
    }
  } else if (guard.state === 'suspicious') {
    const want = Math.atan2(player.y - guard.y, player.x - guard.x);
    guard.facing = turnToward(guard.facing, want, dt * 8);
  } else if (guard.state === 'chase') {
    const want = Math.atan2(player.y - guard.y, player.x - guard.x);
    guard.facing = turnToward(guard.facing, want, dt * 10);
    const speed = guard.speed * 1.55;
    moveCircle(guard, Math.cos(guard.facing) * speed * dt, Math.sin(guard.facing) * speed * dt, 13);
    if (d < CATCH_DIST) {
      loseGame('Caught by a guard');
      return;
    }
    if (guard.lostTimer > 3) {
      guard.state = 'investigate';
      guard.waitTimer = 0;
    }
  } else if (guard.state === 'investigate') {
    const target = guard.lastSeen;
    const dist = Math.hypot(target.x - guard.x, target.y - guard.y);
    if (dist > 8) {
      const want = Math.atan2(target.y - guard.y, target.x - guard.x);
      guard.facing = turnToward(guard.facing, want, dt * 8);
      moveCircle(guard, Math.cos(guard.facing) * guard.speed * 1.15 * dt, Math.sin(guard.facing) * guard.speed * 1.15 * dt, 13);
    } else {
      guard.waitTimer += dt;
      guard.facing += dt * 1.4;
      if (guard.waitTimer > 2) {
        guard.state = 'patrol';
        guard.wpIndex = nearestWaypoint(guard);
      }
    }
  }
}

function nearestWaypoint(guard) {
  let best = 0;
  let bestDist = Infinity;
  guard.waypoints.forEach((wp, i) => {
    const d = Math.hypot(wp.x - guard.x, wp.y - guard.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function turnToward(current, target, maxStep) {
  const diff = angleDiff(target, current);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

// ---- player update ----
function updatePlayer(dt) {
  let mx = 0;
  let my = 0;
  if (keys.has('arrowup') || keys.has('w')) my -= 1;
  if (keys.has('arrowdown') || keys.has('s')) my += 1;
  if (keys.has('arrowleft') || keys.has('a')) mx -= 1;
  if (keys.has('arrowright') || keys.has('d')) mx += 1;
  player.sneaking = keys.has('shift');
  player.moving = mx !== 0 || my !== 0;
  if (!player.moving) return;
  const len = Math.hypot(mx, my);
  mx /= len;
  my /= len;
  const speed = player.sneaking ? SNEAK_SPEED : WALK_SPEED;
  player.facing = Math.atan2(my, mx);
  const inPlant = tileAtPx(player.x, player.y) === 'T';
  const slow = inPlant ? 0.55 : 1;
  moveCircle(player, mx * speed * slow * dt, my * speed * slow * dt, PLAYER_R);

  // Footsteps: running is loud enough to draw guards.
  stepTimer -= dt;
  if (stepTimer <= 0) {
    stepTimer = player.sneaking ? 0.55 : 0.34;
    sfx.step(stepAlternate);
    stepAlternate = !stepAlternate;
    if (!player.sneaking) {
      noisePulse = NOISE_RADIUS;
      for (const guard of guards) {
        if (guard.state === 'patrol' || guard.state === 'suspicious') {
          const d = Math.hypot(guard.x - player.x, guard.y - player.y);
          if (d < NOISE_RADIUS) guardInvestigate(guard, player.x, player.y);
        }
      }
    }
  }
}

function updateCoins(dt) {
  if (coinFlight) {
    coinFlight.t += dt / 0.28;
    if (coinFlight.t >= 1) {
      const { x, y } = coinFlight;
      coinsOnFloor.push({ x, y, ttl: 12 });
      sfx.coin();
      for (const guard of guards) {
        if (Math.hypot(guard.x - x, guard.y - y) < COIN_RANGE) {
          guardInvestigate(guard, x, y);
        }
      }
      coinFlight = null;
    }
  }
  for (const coin of coinsOnFloor) coin.ttl -= dt;
  coinsOnFloor = coinsOnFloor.filter((c) => c.ttl > 0);
}

function update(dt) {
  if (screen !== 'playing') return;
  elapsed += dt;
  updatePlayer(dt);
  for (const guard of guards) {
    updateGuard(guard, dt);
    if (screen !== 'playing') return;
  }
  updateCoins(dt);
  for (const relic of relics) {
    if (!relic.taken && Math.hypot(player.x - relic.x, player.y - relic.y) < 30) {
      relic.taken = true;
      sfx.pickup();
      if (exitOpen()) sfx.exitOpen();
      updateHud();
    }
  }
  if (exitOpen() && exitTile && Math.hypot(player.x - exitTile.x, player.y - exitTile.y) < 34) {
    winLevel();
    return;
  }
  if (noisePulse > 0) noisePulse = Math.max(0, noisePulse - dt * 260);
  updateHud();
}

// ---- rendering ----
function drawFloor() {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = grid[r][c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === '#') {
        ctx.fillStyle = '#232733';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#31364a';
        ctx.fillRect(x, y, TILE, 5);
        continue;
      }
      const light = (r + c) % 2 === 0;
      if (ch === 'S') {
        ctx.fillStyle = light ? '#1d2338' : '#1a1f31';
      } else {
        ctx.fillStyle = light ? '#3a3f52' : '#343947';
      }
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    }
  }
  // Warm pools under the lamps, painted on the floor itself.
  for (const lamp of lamps) {
    const c = tileCenter(lamp[0], lamp[1]);
    const g = ctx.createRadialGradient(c.x, c.y, 6, c.x, c.y, 95);
    g.addColorStop(0, 'rgba(255, 214, 130, 0.20)');
    g.addColorStop(1, 'rgba(255, 214, 130, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - 95, c.y - 95, 190, 190);
  }
}

function drawCover() {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = grid[r][c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === 'C') {
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        ctx.strokeStyle = '#8a6238';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 4);
        ctx.lineTo(x + TILE - 4, y + TILE - 4);
        ctx.moveTo(x + TILE - 4, y + 4);
        ctx.lineTo(x + 4, y + TILE - 4);
        ctx.stroke();
      } else if (ch === 'P') {
        ctx.fillStyle = '#4d5468';
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE / 2, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6a7186';
        ctx.beginPath();
        ctx.arc(x + TILE / 2 - 4, y + TILE / 2 - 4, 11, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch === 'T') {
        ctx.fillStyle = '#2c5a34';
        for (const [ox, oy, rad] of [[-8, 6, 12], [8, 4, 13], [0, -8, 12], [-2, 10, 10]]) {
          ctx.beginPath();
          ctx.arc(x + TILE / 2 + ox, y + TILE / 2 + oy, rad, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#3f7a48';
        ctx.beginPath();
        ctx.arc(x + TILE / 2 - 3, y + TILE / 2 - 3, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Lamp posts.
  for (const lamp of lamps) {
    const c = tileCenter(lamp[0], lamp[1]);
    ctx.fillStyle = '#8a6d2f';
    ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
    ctx.fillStyle = '#ffd682';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

const RELIC_COLORS = ['#ff5d73', '#4ade80', '#60a5fa'];

function drawRelicsAndExit(time) {
  for (const relic of relics) {
    if (relic.taken) continue;
    const bob = Math.sin(time / 350 + relic.x) * 3;
    const color = RELIC_COLORS[relic.hue % RELIC_COLORS.length];
    const glow = ctx.createRadialGradient(relic.x, relic.y + bob, 2, relic.x, relic.y + bob, 30);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(relic.x - 30, relic.y + bob - 30, 60, 60);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(relic.x, relic.y + bob);
    ctx.rotate(Math.sin(time / 600 + relic.x) * 0.35);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (exitTile) {
    const open = exitOpen();
    const pulse = open ? 0.6 + Math.sin(time / 300) * 0.25 : 0.25;
    ctx.save();
    ctx.translate(exitTile.x, exitTile.y);
    ctx.fillStyle = open ? '#14532d' : '#3f1d1d';
    ctx.fillRect(-16, -20, 32, 40);
    ctx.strokeStyle = open ? `rgba(74, 222, 128, ${pulse + 0.3})` : '#7f1d1d';
    ctx.lineWidth = 3;
    ctx.strokeRect(-16, -20, 32, 40);
    ctx.fillStyle = open ? '#4ade80' : '#f87171';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(open ? 'EXIT' : 'LOCKED', 0, 4);
    ctx.restore();
  }
}

function drawCone(guard) {
  const color = guard.state === 'chase' ? '231, 72, 77' : '245, 197, 66';
  const alpha = guard.state === 'chase' ? 0.42 : 0.3;
  const g = ctx.createRadialGradient(guard.x, guard.y, 10, guard.x, guard.y, guard.range);
  g.addColorStop(0, `rgba(${color}, ${alpha})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(guard.x, guard.y);
  ctx.arc(guard.x, guard.y, guard.range, guard.facing - guard.fov, guard.facing + guard.fov);
  ctx.closePath();
  ctx.fill();
}

function drawFigure(x, y, facing, body, trim) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = trim;
  ctx.beginPath();
  ctx.arc(0, 0, 13, facing - 0.9, facing + 0.9);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  // Direction tick.
  ctx.strokeStyle = trim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(Math.cos(facing) * 13, Math.sin(facing) * 13);
  ctx.lineTo(Math.cos(facing) * 20, Math.sin(facing) * 20);
  ctx.stroke();
  ctx.restore();
}

function drawGuardsAndPlayer(time) {
  for (const guard of guards) drawCone(guard);
  for (const guard of guards) {
    drawFigure(guard.x, guard.y, guard.facing, '#7f1d2e', '#c2414f');
    if (guard.state === 'chase' || guard.state === 'suspicious') {
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = guard.state === 'chase' ? '#ff6b6b' : '#ffd166';
      ctx.fillText(guard.state === 'chase' ? '!' : '?', guard.x, guard.y - 24);
    }
  }
  // Thrown coins on the floor.
  for (const coin of coinsOnFloor) {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6d2f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (coinFlight) {
    const t = coinFlight.t;
    const x = coinFlight.x0 + (coinFlight.x1 - coinFlight.x0) * t;
    const y = coinFlight.y0 + (coinFlight.y1 - coinFlight.y0) * t - Math.sin(t * Math.PI) * 26;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Noise ring while running.
  if (noisePulse > 0) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${noisePulse / NOISE_RADIUS * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, NOISE_RADIUS - noisePulse, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawFigure(player.x, player.y, player.facing, '#1e2a4a', '#7dd3fc');
  // Hood point.
  ctx.fillStyle = '#0f1830';
  ctx.beginPath();
  ctx.arc(player.x + Math.cos(player.facing) * 6, player.y + Math.sin(player.facing) * 6, 6, 0, Math.PI * 2);
  ctx.fill();
  void time;
}

function drawDarkness() {
  darkCtx.clearRect(0, 0, W, H);
  darkCtx.globalCompositeOperation = 'source-over';
  // Behind a menu overlay the level is a backdrop, so the night is
  // lighter there; while playing, the dark is what makes hiding matter.
  const night = screen === 'playing' ? 0.78 : 0.42;
  darkCtx.fillStyle = `rgba(3, 5, 16, ${night})`;
  darkCtx.fillRect(0, 0, W, H);
  darkCtx.globalCompositeOperation = 'destination-out';
  for (const lamp of lamps) {
    const c = tileCenter(lamp[0], lamp[1]);
    const g = darkCtx.createRadialGradient(c.x, c.y, 10, c.x, c.y, 130);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    darkCtx.fillStyle = g;
    darkCtx.fillRect(c.x - 130, c.y - 130, 260, 260);
  }
  const pg = darkCtx.createRadialGradient(player.x, player.y, 10, player.x, player.y, 120);
  pg.addColorStop(0, 'rgba(0,0,0,0.9)');
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  darkCtx.fillStyle = pg;
  darkCtx.fillRect(player.x - 120, player.y - 120, 240, 240);
  ctx.drawImage(darkCanvas, 0, 0);
}

function drawObjectiveArrow() {
  if (screen !== 'playing') return;
  let target = null;
  for (const relic of relics) {
    if (!relic.taken) {
      target = relic;
      break;
    }
  }
  if (!target && exitOpen()) target = exitTile;
  if (!target) return;
  const d = Math.hypot(target.x - player.x, target.y - player.y);
  if (d < 60) return;
  const angle = Math.atan2(target.y - player.y, target.x - player.x);
  const ax = player.x + Math.cos(angle) * 34;
  const ay = player.y + Math.sin(angle) * 34;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function render(time) {
  ctx.clearRect(0, 0, W, H);
  drawFloor();
  drawCover();
  drawRelicsAndExit(time);
  drawGuardsAndPlayer(time);
  drawDarkness();
  drawObjectiveArrow();
}

// ---- input ----
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
    event.preventDefault();
  }
  if (key === 'm') {
    setMuted(!isMuted());
    $('mute-btn').textContent = isMuted() ? '🔇 Muted' : '🔊 Sound';
    return;
  }
  if (key === 'p' || key === 'escape') {
    if (screen === 'playing') pauseGame();
    else if (screen === 'paused') resumeGame();
    return;
  }
  if (key === 'r' && (screen === 'won' || screen === 'lost')) {
    startLevel(levelIndex);
    return;
  }
  if (key === 'enter' && screen === 'menu') {
    startGame();
    return;
  }
  keys.add(key);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener('mousedown', (event) => {
  unlockAudio();
  if (screen !== 'playing') return;
  if (coinsLeft <= 0) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  coinsLeft -= 1;
  coinFlight = { x0: player.x, y0: player.y, x1: x, y1: y, t: 0 };
  updateHud();
});

$('start-btn').addEventListener('click', () => startGame());
$('resume-btn').addEventListener('click', () => resumeGame());
$('restart-btn').addEventListener('click', () => startLevel(levelIndex));
$('retry-btn').addEventListener('click', () => startLevel(levelIndex));
$('menu-btn').addEventListener('click', () => {
  loadLevel(0);
  screen = 'menu';
  showOnly(overlayMenu);
  updateHud();
});
winNext.addEventListener('click', () => {
  if (levelIndex >= LEVELS.length - 1) startGame();
  else startLevel(levelIndex + 1);
});
$('mute-btn').addEventListener('click', () => {
  setMuted(!isMuted());
  $('mute-btn').textContent = isMuted() ? '🔇 Muted' : '🔊 Sound';
});

// ---- screenshot poses: deterministic, no randomness ----
function poseShot(name) {
  document.body.classList.add('shot');
  if (name === 'start') {
    loadLevel(0);
    screen = 'menu';
    showOnly(overlayMenu);
    updateHud();
  } else if (name === 'play') {
    loadLevel(0);
    screen = 'playing';
    showOnly(null);
    // One relic already stolen; the thief sneaks west past a crate
    // while the first guard's cone sweeps down the same row.
    relics[0].taken = true;
    player.x = tileCenter(8, 3).x;
    player.y = tileCenter(8, 3).y;
    player.facing = Math.PI;
    player.sneaking = true;
    guards[0].x = tileCenter(12, 3).x;
    guards[0].y = tileCenter(12, 3).y;
    guards[0].facing = Math.PI;
    guards[1].x = tileCenter(17, 8).x;
    guards[1].y = tileCenter(17, 8).y;
    guards[1].facing = Math.PI / 2;
    elapsed = 47;
    updateHud();
  } else if (name === 'alert') {
    loadLevel(0);
    screen = 'playing';
    showOnly(null);
    relics[0].taken = true;
    player.x = tileCenter(10, 6).x;
    player.y = tileCenter(10, 6).y;
    player.facing = 0;
    guards[0].x = tileCenter(12, 6).x;
    guards[0].y = tileCenter(12, 6).y;
    guards[0].facing = Math.PI;
    guards[0].state = 'chase';
    guards[0].suspicion = 1;
    alarms = 1;
    ghost = false;
    elapsed = 83;
    updateHud();
  } else if (name === 'end') {
    loadLevel(0);
    screen = 'playing';
    showOnly(null);
    for (const relic of relics) relic.taken = true;
    player.x = exitTile.x - 30;
    player.y = exitTile.y;
    player.facing = 0;
    elapsed = 132;
    alarms = 0;
    // Show the win overlay as the posed frame.
    screen = 'won';
    winTitle.textContent = 'Clean Getaway';
    winStats.textContent = `${LEVELS[0].name} cleared in ${formatTime(elapsed)} · alarms raised: 0 · GHOST — never chased`;
    winNext.textContent = 'Next level';
    showOnly(overlayWin);
    updateHud();
  }
  render(1000);
  window.__shotReady = true;
}

// ---- test handle: drives the game without touching the DOM ----
window.__game = {
  get screen() { return screen; },
  get levelIndex() { return levelIndex; },
  get player() { return player; },
  get guards() { return guards; },
  get relics() { return relics; },
  get coinsLeft() { return coinsLeft; },
  get elapsed() { return elapsed; },
  get alarms() { return alarms; },
  start: startGame,
  startLevel,
  pause: pauseGame,
  resume: resumeGame,
  teleport(tx, ty) {
    const c = tileCenter(tx, ty);
    player.x = c.x;
    player.y = c.y;
  },
  collectAllRelics() {
    for (const relic of relics) relic.taken = true;
    updateHud();
  },
  forceChase(index = 0) {
    const guard = guards[index];
    guard.state = 'chase';
    guard.suspicion = 1;
    guard.lastSeen = { x: player.x, y: player.y };
    alarms += 1;
    ghost = false;
  },
  throwCoinAt(tx, ty) {
    if (coinsLeft <= 0) return false;
    const c = tileCenter(tx, ty);
    coinsLeft -= 1;
    coinsOnFloor.push({ x: c.x, y: c.y, ttl: 12 });
    for (const guard of guards) {
      if (Math.hypot(guard.x - c.x, guard.y - c.y) < COIN_RANGE) {
        guardInvestigate(guard, c.x, c.y);
      }
    }
    updateHud();
    return true;
  },
  keyDown(key) { keys.add(key.toLowerCase()); },
  keyUp(key) { keys.delete(key.toLowerCase()); },
  summary() {
    return {
      screen,
      level: LEVELS[levelIndex].name,
      relicsLeft: relicsLeft(),
      coinsLeft,
      elapsed: Math.round(elapsed),
      alarms,
      player: { x: Math.round(player.x), y: Math.round(player.y) },
      guards: guards.map((g) => ({
        state: g.state,
        suspicion: Math.round(g.suspicion * 100) / 100,
        x: Math.round(g.x),
        y: Math.round(g.y),
      })),
    };
  },
};

// ---- boot + main loop ----
loadLevel(0);
screen = 'menu';
showOnly(overlayMenu);
updateHud();

const params = new URLSearchParams(window.location.search);
shotMode = params.get('shot');
if (shotMode) {
  poseShot(shotMode);
} else {
  const loop = (now) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (screen === 'playing') update(dt);
    render(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
