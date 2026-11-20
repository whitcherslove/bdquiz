// Звуки синтезируются браузером (Web Audio), файлов не нужно. Громкость специально тихая.
let ctx = null;
let muted = (() => { try { return localStorage.getItem('bdquiz:muted') === '1'; } catch { return false; } })();

export function unlockAudio() {
  if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; ctx = new A(); }
  if (ctx.state === 'suspended') ctx.resume();
}
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('bdquiz:muted', muted ? '1' : '0'); } catch { /* ok */ }
  return muted;
}

function tone(freq, at, dur, { type = 'sine', vol = .06, to } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + .015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + .05);
}
const arp = (notes, step, dur, opt) => notes.forEach((f, i) => tone(f, i * step, dur, opt));

export const sfx = {
  join: () => tone(880, 0, .12, { vol: .035 }),
  start: () => arp([523, 784], .09, .18, { type: 'triangle', vol: .04 }),
  tick: () => tone(1100, 0, .05, { type: 'square', vol: .018 }),
  tickLast: () => tone(1500, 0, .07, { type: 'square', vol: .025 }),
  timeUp: () => { tone(523, 0, .22, { vol: .06 }); tone(392, .13, .45, { vol: .06 }); },
  reveal: () => arp([659, 784, 988], .08, .35, { type: 'triangle', vol: .045 }),
  board: () => arp([523, 659, 784, 1047], .07, .3, { type: 'triangle', vol: .035 }),
  intro: () => tone(196, 0, .6, { type: 'triangle', vol: .04, to: 784 }),
  fanfare: () => { arp([523, 659, 784], .12, .3, { type: 'triangle', vol: .05 }); arp([1047, 1319, 1568], .12, .7, { type: 'triangle', vol: .04 }); },
  pop: () => tone(620, 0, .09, { vol: .025, to: 980 }),
};
