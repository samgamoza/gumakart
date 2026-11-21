import { spawn } from "node:child_process";

/**
 * FFmpeg helpers for the video-ad assembly. Every path handed to ffmpeg is RELATIVE to `cwd`
 * (the job's work folder) — the `ass` filter can't take Windows drive paths like D:\… unescaped.
 */
export class FfmpegError extends Error {
  constructor(message: string, readonly stderrTail: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

export function run(bin: string, args: string[], cwd: string, timeoutMs = 10 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new FfmpegError(`could not start ${bin}: ${e.message}`, ""));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${bin} exited with ${code}`, stderr.slice(-1500)));
    });
  });
}

/** Media duration in seconds via ffprobe next to ffmpeg (or on PATH). */
export async function probeDuration(ffmpegPath: string, file: string, cwd: string): Promise<number> {
  const probe = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (_m, exe: string | undefined) => `ffprobe${exe ?? ""}`);
  const { stdout } = await run(probe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], cwd, 60_000);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new FfmpegError(`could not read duration of ${file}`, stdout);
  return d;
}

let encoderCache: Promise<"h264_nvenc" | "libx264"> | null = null;

export function detectEncoder(ffmpegPath: string, preference: "auto" | "h264_nvenc" | "libx264"): Promise<"h264_nvenc" | "libx264"> {
  if (preference !== "auto") return Promise.resolve(preference);
  encoderCache ??= run(ffmpegPath, ["-hide_banner", "-encoders"], process.cwd(), 30_000)
    .then(({ stdout }) => (/\bh264_nvenc\b/.test(stdout) ? "h264_nvenc" : "libx264") as "h264_nvenc" | "libx264")
    .catch(() => "libx264" as const);
  return encoderCache;
}

export function encoderArgs(encoder: "h264_nvenc" | "libx264"): string[] {
  return encoder === "h264_nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"];
}

export interface AssembleInput {
  clips: Array<{ file: string; seconds: number; clipSeconds: number }>; // relative paths
  voice: string;
  voiceSeconds: number;
  bgm?: string;
  qrPng: string;
  ass: string;
  durationSec: number;
  endCardSec: number;
  output: string;
}

/** Builds the ffmpeg argument list (pure — unit tested). */
export function assembleArgs(input: AssembleInput, encoder: "h264_nvenc" | "libx264"): { args: string[]; atempo: number } {
  const D = input.durationSec;
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const c of input.clips) args.push("-i", c.file);
  const vIdx = input.clips.length;
  args.push("-i", input.voice);
  let bgmIdx = -1;
  if (input.bgm) {
    bgmIdx = vIdx + 1;
    args.push("-stream_loop", "-1", "-i", input.bgm);
  }
  const qrIdx = vIdx + (input.bgm ? 2 : 1);
  args.push("-loop", "1", "-i", input.qrPng);

  const parts: string[] = [];
  input.clips.forEach((c, i) => {
    // Slow a short Wan clip down to fill its scene (≤2.5×), then hold the last frame for any rest.
    const stretch = Math.min(Math.max(c.seconds / Math.max(c.clipSeconds, 0.1), 1), 2.5);
    parts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,` +
        `setpts=${stretch.toFixed(3)}*(PTS-STARTPTS),tpad=stop_mode=clone:stop_duration=${Math.ceil(c.seconds + 1)},` +
        `trim=duration=${c.seconds.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
    );
  });
  parts.push(`${input.clips.map((_c, i) => `[v${i}]`).join("")}concat=n=${input.clips.length}:v=1:a=0[vc]`);
  parts.push(`[vc]ass=${input.ass}[vs]`);
  parts.push(`[${qrIdx}:v]scale=400:400,format=rgba[qr]`);
  parts.push(`[vs][qr]overlay=x=(W-w)/2:y=H*0.44:enable='gte(t,${(D - input.endCardSec).toFixed(2)})',format=yuv420p[vout]`);

  // Speak within the ad (leave ~0.6 s of air at the end): speed the voice up to 1.3× if needed.
  const room = D - 0.6;
  const atempo = input.voiceSeconds > room ? Math.min(input.voiceSeconds / room, 1.3) : 1;
  parts.push(`[${vIdx}:a]aresample=48000,atempo=${atempo.toFixed(3)},apad,atrim=0:${D},asetpts=PTS-STARTPTS[voice]`);
  if (bgmIdx >= 0) {
    parts.push(`[${bgmIdx}:a]aresample=48000,volume=0.14,atrim=0:${D},afade=t=out:st=${(D - 1.5).toFixed(2)}:d=1.5[bed]`);
    parts.push(`[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
  } else {
    parts.push(`[voice]anull[aout]`);
  }

  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    ...encoderArgs(encoder),
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-t",
    String(D),
    "-movflags",
    "+faststart",
    input.output
  );
  return { args, atempo };
}

/** Assemble; if NVENC is listed but the GPU refuses (busy / driver), retry once on libx264. */
export async function assembleVideo(ffmpegPath: string, cwd: string, input: AssembleInput, encoder: "h264_nvenc" | "libx264"): Promise<{ encoder: string; atempo: number }> {
  try {
    const { args, atempo } = assembleArgs(input, encoder);
    await run(ffmpegPath, args, cwd);
    return { encoder, atempo };
  } catch (error) {
    if (encoder !== "h264_nvenc") throw error;
    const { args, atempo } = assembleArgs(input, "libx264");
    await run(ffmpegPath, args, cwd);
    return { encoder: "libx264", atempo };
  }
}

export async function thumbnail(ffmpegPath: string, cwd: string, video: string, output: string): Promise<void> {
  await run(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.0", "-i", video, "-frames:v", "1", "-q:v", "3", output], cwd, 60_000);
}
