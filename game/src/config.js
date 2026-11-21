// The Quiet Gallery — level data.
// One tile is 48 px; every map is 24 columns by 14 rows.
// Legend: # wall, . floor, S shadow floor, C crate, P pillar, T tall plant,
// R relic, E exit door, p player start.
// Crates and pillars block movement and sight; plants block sight only
// (the thief slips through them slowly); shadow floor makes the thief
// harder to spot; lamps light pools that make the thief easier to spot.

export const TILE = 48;
export const COLS = 24;
export const ROWS = 14;

export const LEVELS = [
  {
    name: 'Level 1 — The Quiet Gallery',
    intro: 'Steal the three relics and slip out the east door unseen.',
    map: [
      '########################',
      '#..........#...........#',
      '#.R....C...#....P...R..#',
      '#..........#...........#',
      '#...C..........C.......#',
      '#..........#...........#',
      '#.P....S...#...S....P..#',
      '#..........#...........#',
      '#...C..........C.......#',
      '#..........#...........#',
      '#.R....P...#....C...E..#',
      '#..........#...........#',
      '#p.........#...........#',
      '########################',
    ],
    lamps: [[6, 2], [17, 2], [6, 10], [17, 10], [12, 6]],
    guards: [
      {
        x: 5, y: 3,
        waypoints: [[5, 3], [19, 3]],
        speed: 62, range: 185, fov: 0.62,
      },
      {
        x: 18, y: 6,
        waypoints: [[18, 6], [18, 11], [14, 11], [14, 6]],
        speed: 58, range: 175, fov: 0.62,
      },
    ],
  },
  {
    name: 'Level 2 — The Vault Wing',
    intro: 'Three guards now, and the vault wing is better lit. Stay in the dark.',
    map: [
      '########################',
      '#.....C....#.....C.....#',
      '#.R....P...#...R....P..#',
      '#.....C....#.....C.....#',
      '#..S...........S.......#',
      '#.....P....#....P......#',
      '#.C....C...#...C....C..#',
      '#..........#...........#',
      '#..S...P.......P...S...#',
      '#.....C....#.....C.....#',
      '#.R....C...#........E..#',
      '#..........#...........#',
      '#p....S....#.....S.....#',
      '########################',
    ],
    lamps: [[6, 2], [17, 6], [6, 10], [17, 2], [12, 12]],
    guards: [
      {
        x: 4, y: 3,
        waypoints: [[4, 3], [19, 3]],
        speed: 68, range: 190, fov: 0.6,
      },
      {
        x: 19, y: 6,
        waypoints: [[19, 6], [19, 11], [15, 11]],
        speed: 64, range: 180, fov: 0.6,
      },
      {
        x: 6, y: 8,
        waypoints: [[6, 8], [6, 11], [9, 11], [9, 8]],
        speed: 60, range: 175, fov: 0.62,
      },
    ],
  },
  {
    name: 'Level 3 — The Director\'s Wing',
    intro: 'Four guards, wide sightlines, and nowhere to hide but the plants.',
    map: [
      '########################',
      '#..C.......#.......C...#',
      '#.R...P....#....P....R.#',
      '#..C...T...#...T...C...#',
      '#......................#',
      '#.S...C....#....C...S..#',
      '#..........#...........#',
      '#..P...S...#...S...P...#',
      '#..........#...........#',
      '#.C...T.........T...C..#',
      '#.R....P...#....P...E..#',
      '#..........#...........#',
      '#p....S....#....S......#',
      '########################',
    ],
    lamps: [[12, 2], [5, 6], [18, 6], [12, 10], [5, 12], [18, 12]],
    guards: [
      {
        x: 5, y: 3,
        waypoints: [[5, 3], [19, 3]],
        speed: 74, range: 195, fov: 0.58,
      },
      {
        x: 19, y: 5,
        waypoints: [[19, 5], [19, 11], [14, 11], [14, 5]],
        speed: 70, range: 185, fov: 0.58,
      },
      {
        x: 5, y: 8,
        waypoints: [[5, 8], [9, 8], [9, 11], [5, 11]],
        speed: 66, range: 180, fov: 0.6,
      },
      {
        x: 12, y: 6,
        waypoints: [[12, 6], [12, 9], [16, 9], [16, 6]],
        speed: 66, range: 180, fov: 0.6,
      },
    ],
  },
];

// Validate every map at load time: rows are the right shape and a walk
// from the player start can reach every relic and the exit.
export function validateLevels() {
  const problems = [];
  for (const level of LEVELS) {
    if (level.map.length !== ROWS) {
      problems.push(`${level.name}: ${level.map.length} rows, expected ${ROWS}`);
      continue;
    }
    for (let r = 0; r < ROWS; r += 1) {
      if (level.map[r].length !== COLS) {
        problems.push(`${level.name} row ${r}: ${level.map[r].length} chars, expected ${COLS}`);
      }
    }
    const grid = level.map.map((row) => row.split(''));
    let start = null;
    const targets = [];
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (grid[r][c] === 'p') start = [c, r];
        if (grid[r][c] === 'R' || grid[r][c] === 'E') targets.push([c, r, grid[r][c]]);
      }
    }
    if (!start) {
      problems.push(`${level.name}: no player start`);
      continue;
    }
    const seen = new Set([`${start[0]},${start[1]}`]);
    const queue = [start];
    const solid = new Set(['#', 'C', 'P']);
    while (queue.length > 0) {
      const [cx, cy] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (solid.has(grid[ny][nx])) continue;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    for (const [tx, ty, kind] of targets) {
      if (!seen.has(`${tx},${ty}`)) {
        problems.push(`${level.name}: ${kind} at ${tx},${ty} unreachable`);
      }
    }
    const relics = targets.filter((t) => t[2] === 'R').length;
    if (relics !== 3) problems.push(`${level.name}: ${relics} relics, expected 3`);
  }
  return problems;
}
