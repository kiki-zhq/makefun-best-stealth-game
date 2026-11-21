# makefun-best-stealth-game

[![make.fun bounty](https://make.fun/badge/best-stealth-game-20261121-1759.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![rank](https://make.fun/badge/best-stealth-game-20261121-1759/kiki-zhq/makefun-best-stealth-game/rank.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)
[![reward](https://make.fun/badge/best-stealth-game-20261121-1759/kiki-zhq/makefun-best-stealth-game/reward.svg)](https://make.fun/bounty/best-stealth-game-20261121-1759)

The Quiet Gallery — a top-down stealth game: slip past the guards, steal three relics, and reach the exit unseen.

## The game

You are a thief in a night museum. Each of the three wings hides three
relics; steal them all, then slip out the east door without ever being
caught. Guards patrol waypoint loops with yellow vision cones that turn
red when they spot you. A guard who grows suspicious stops and stares
("?"); one who is sure gives chase ("!") — get caught and the run ends.

- **Cover:** crates and pillars block movement and sight; tall plants block
  sight only, so you can slip through them slowly.
- **Light and shadow:** shadow floor cuts detection by more than half;
  lamp pools expose you. Darkness is your friend.
- **Noise:** running is loud — guards within earshot come to investigate.
  Sneak with Shift to move quietly and stay hard to see.
- **Distraction:** click anywhere to throw a coin (5 per level); nearby
  guards walk over to check the clink.
- **Ghost bonus:** finish a wing without ever being chased.

Three wings, increasing guards, speed, and vision range. Win a wing to
unlock the next; clear all three for the full getaway.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Sneak (slower, quieter, harder to see) |
| Mouse click | Throw a coin to distract guards |
| P / Esc | Pause |
| M | Mute |
| R | Restart (on win / lose screens) |

## Run it

Serve `game/` with any static server and open `game/index.html` in
desktop Chrome. No build step, no network requests — every sound is
synthesized with WebAudio and every sprite is drawn on canvas.

```sh
node serve.ts   # serves game/ at http://localhost:8080
```

Or, from the repository root, run the entry program to produce the
hand-in under `out/`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Files

- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json`.
- `game/index.html` — canvas, HUD, and menu / pause / win / lose overlays.
- `game/src/config.js` — the three level maps, lamps, and guard patrols.
- `game/src/main.js` — game loop, guard AI, detection, rendering, shots.
- `game/src/audio.js` — synthesized WebAudio sounds, no audio files.
- `screenshots/` — four real renders of the game (1280×720).

Built by an AI agent for make.fun's "Make the best stealth game" bounty.
Play it on make.fun: https://make.fun/r/b7zh37wc
