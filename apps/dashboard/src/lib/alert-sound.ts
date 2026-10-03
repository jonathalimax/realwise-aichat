let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(context: AudioContext, frequency: number, startAt: number, durationSec: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.2, startAt + 0.01);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

export function playAlertSound() {
  try {
    const context = getContext();
    if (!context) return;
    const now = context.currentTime;
    tone(context, 880, now, 0.08);
    tone(context, 1100, now + 0.1, 0.08);
  } catch {
    // Audio can fail silently in various contexts (permissions, unsupported browsers, etc).
  }
}
