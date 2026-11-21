// The Quiet Gallery — all sounds are synthesized with WebAudio.
// No audio files, no network: every sound is a few oscillators and
// envelopes built at run time. The audio context is created lazily on
// the first user gesture so browsers do not block it.

let ctx = null;
let muted = false;
let master = null;

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ensureContext();
}

export function setMuted(value) {
  muted = Boolean(value);
  if (master) master.gain.value = muted ? 0 : 0.5;
}

export function isMuted() {
  return muted;
}

// One short tone: a sine or triangle blip that slides from `fromHz`
// to `toHz` over `seconds`, fading out.
function blip({ type = 'sine', fromHz = 440, toHz = null, seconds = 0.12, volume = 0.25, delay = 0 }) {
  if (muted) return;
  const audio = ensureContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, start);
  if (toHz !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), start + seconds);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop(start + seconds + 0.05);
}

// A filtered noise burst: the coin clink and the soft footstep.
function noiseBurst({ seconds = 0.08, volume = 0.2, filterHz = 2400, delay = 0 }) {
  if (muted) return;
  const audio = ensureContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterHz;
  filter.Q.value = 1.2;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(start);
}

export const sfx = {
  // Soft tap, alternating pitch so a walk sounds like steps.
  step(alternate) {
    noiseBurst({ seconds: 0.05, volume: 0.07, filterHz: alternate ? 700 : 520 });
  },
  // Two-note chime when a relic is picked up.
  pickup() {
    blip({ fromHz: 880, seconds: 0.14, volume: 0.22 });
    blip({ fromHz: 1318, seconds: 0.22, volume: 0.18, delay: 0.07 });
  },
  // Bright metallic clink when a coin lands.
  coin() {
    blip({ type: 'triangle', fromHz: 2093, toHz: 1568, seconds: 0.16, volume: 0.2 });
    noiseBurst({ seconds: 0.05, volume: 0.12, filterHz: 5200 });
  },
  // Low dissonant sting when a guard spots the thief.
  alert() {
    blip({ type: 'sawtooth', fromHz: 220, toHz: 110, seconds: 0.35, volume: 0.16 });
    blip({ type: 'sawtooth', fromHz: 233, toHz: 116, seconds: 0.35, volume: 0.16, delay: 0.02 });
  },
  // Short rising question mark when a guard grows suspicious.
  suspicious() {
    blip({ type: 'triangle', fromHz: 520, toHz: 780, seconds: 0.12, volume: 0.12 });
  },
  // Door creak: a slow low slide when the exit opens.
  exitOpen() {
    blip({ type: 'triangle', fromHz: 180, toHz: 320, seconds: 0.4, volume: 0.14 });
  },
  // Win arpeggio: C major climbing, then a high shimmer.
  win() {
    [523, 659, 784, 1047].forEach((hz, i) => {
      blip({ fromHz: hz, seconds: 0.25, volume: 0.2, delay: i * 0.11 });
    });
    blip({ fromHz: 1568, seconds: 0.5, volume: 0.12, delay: 0.48 });
  },
  // Lose: a short descending minor phrase.
  lose() {
    [392, 330, 262, 196].forEach((hz, i) => {
      blip({ type: 'triangle', fromHz: hz, seconds: 0.28, volume: 0.18, delay: i * 0.13 });
    });
  },
};
