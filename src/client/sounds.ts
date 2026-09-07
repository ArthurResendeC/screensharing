type ToneName = 'connect' | 'disconnect' | 'share-start' | 'share-stop';

type Tone = {
  freqs: number[];
  dur: number;
  gap: number;
  type: OscillatorType;
};

// Short synthesized tones (Web Audio oscillators, no audio files) for session state changes.
const TONES: Record<ToneName, Tone> = {
  connect: { freqs: [523.25, 659.25], dur: 0.09, gap: 0.07, type: 'sine' }, // C5 → E5, rising
  disconnect: { freqs: [523.25, 392.0], dur: 0.1, gap: 0.08, type: 'sine' }, // C5 → G4, falling
  'share-start': { freqs: [880], dur: 0.12, gap: 0, type: 'triangle' },
  'share-stop': { freqs: [440, 330], dur: 0.11, gap: 0.02, type: 'triangle' },
};

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// Browsers only let audio start after a user gesture; unlock the context on the first one.
export function unlockSounds() {
  const listener = () => {
    getContext();
    window.removeEventListener('pointerdown', listener);
    window.removeEventListener('keydown', listener);
  };
  window.addEventListener('pointerdown', listener, { once: true });
  window.addEventListener('keydown', listener, { once: true });
}

export function playSound(name: ToneName) {
  const audioCtx = getContext();
  if (!audioCtx || audioCtx.state !== 'running') return;
  const tone = TONES[name];
  let t = audioCtx.currentTime;
  for (const freq of tone.freqs) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + tone.dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + tone.dur + 0.02);
    t += tone.dur + tone.gap;
  }
}
