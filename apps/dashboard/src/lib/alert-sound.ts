let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtor) return null;
  if (!ctx) ctx = new AudioCtor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(context: AudioContext, frequency: number, startAt: number, durationSec: number, peakGain: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.015);
  gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSec);
}

// A short two-note "ding-dong" was easy to miss in a busy room — this is a brighter 3-note
// ascending chime (louder, played twice back-to-back) designed to actually pull attention when a
// visitor needs a human, without becoming a full siren.
export function playAlertSound() {
  try {
    const context = getContext();
    if (!context) return;
    const now = context.currentTime;
    const notes = [880, 1108.73, 1318.51]; // A5, C#6, E6 — bright major triad, ascending
    const noteDuration = 0.14;
    const noteGap = 0.1;
    const peakGain = 0.35;
    [0, 1].forEach((repeat) => {
      const repeatOffset = repeat * (notes.length * noteGap + 0.18);
      notes.forEach((freq, i) => {
        tone(context, freq, now + repeatOffset + i * noteGap, noteDuration, peakGain);
      });
    });
  } catch {
    // Audio can fail silently in various contexts (permissions, unsupported browsers, etc).
  }
}
