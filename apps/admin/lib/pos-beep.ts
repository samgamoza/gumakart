/**
 * Harvest H4 (palenkeAi's scanner beep): a short high beep when a scan adds an item, a low buzz when
 * the code isn't found. WebAudio only — no sound files. Silent if the browser blocks audio.
 */
let ctx: AudioContext | null = null;

export function posBeep(ok: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    ctx ??= new Ctx();
    void ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 920 : 220;
    const t = ctx.currentTime;
    const len = ok ? 0.09 : 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(ok ? 0.3 : 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + len);
  } catch {
    /* no audio */
  }
}

export type PaperWidth = "80" | "58";
const PAPER_KEY = "guma-pos-paper:v1";

export function readPaperWidth(): PaperWidth {
  try {
    return localStorage.getItem(PAPER_KEY) === "58" ? "58" : "80";
  } catch {
    return "80";
  }
}

export function savePaperWidth(w: PaperWidth): void {
  try {
    localStorage.setItem(PAPER_KEY, w);
  } catch {
    /* ignore */
  }
}

/** Printable width of the receipt for the paper roll (paper minus the printer's margins). */
export const PRINT_WIDTH_MM: Record<PaperWidth, number> = { "80": 72, "58": 48 };
