// Tiny synthesized sounds (Web Audio API, no audio files to ship). The mute choice is remembered in localStorage.

export const SOUND_KEY = "bs-sound";
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Sound is on unless the user muted it (stored as "off"). */
export function soundOn(storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try { return storage?.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}

export function setSoundOn(on: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try { storage?.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* storage blocked: the choice lasts until reload */ }
  listeners.forEach((l) => l(on));
}

/** Every SoundToggle on the page stays in sync through this. Returns the unsubscribe function. */
export function subscribeSound(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try { ctx ??= new AC(); } catch { return null; }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/**
 * A small "pop" - blister foil giving way: 45 ms of crackly high-passed noise plus a quick falling sine.
 * `pitch` around 1 (0.9-1.15) so repeated pops do not sound identical. Returns false when muted or unsupported.
 */
export function playPop(pitch = 1): boolean {
  if (!soundOn()) return false;
  const ac = audio();
  if (!ac) return false;
  try {
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = 0.45;
    out.connect(ac.destination);

    const len = Math.max(1, Math.floor(ac.sampleRate * 0.045));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const ng = ac.createGain();
    ng.gain.value = 0.35;
    noise.connect(hp).connect(ng).connect(out);
    noise.start(t);

    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(140 * pitch, t + 0.09);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.14);
    return true;
  } catch {
    return false;
  }
}
