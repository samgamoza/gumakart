import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import QRCode from "qrcode";
import { assembleArgs, assembleVideo, probeDuration, thumbnail } from "./ffmpeg";
import { buildAss, kineticCues } from "./subtitles";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe("ffmpeg assembly args", () => {
  const base = {
    clips: [
      { file: "clip_0.mp4", seconds: 4, clipSeconds: 5 },
      { file: "clip_1.mp4", seconds: 6, clipSeconds: 3 },
      { file: "clip_2.mp4", seconds: 5, clipSeconds: 1 },
    ],
    voice: "voice.flac",
    voiceSeconds: 16.2,
    qrPng: "qr.png",
    ass: "subs.ass",
    durationSec: 15,
    endCardSec: 3,
    output: "final.mp4",
  };
  it("stretches short clips (≤2.5×), speeds a long voice up to fit (≤1.3×), relative paths only", () => {
    const { args, atempo } = assembleArgs(base, "libx264");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    assert.match(fc, /\[0:v\].*setpts=1\.000\*/);
    assert.match(fc, /\[1:v\].*setpts=2\.000\*/);
    assert.match(fc, /\[2:v\].*setpts=2\.500\*/, "capped at 2.5×, rest held on last frame");
    assert.match(fc, /concat=n=3:v=1:a=0/);
    assert.match(fc, /\[vc\]ass=subs\.ass\[vs\]/);
    assert.match(fc, /enable='gte\(t,12\.00\)'/, "QR shows during the last 3 s");
    assert.ok(atempo > 1.1 && atempo <= 1.3);
    assert.ok(!args.some((a) => /^[A-Za-z]:\\|^\//.test(a)), "no absolute paths (Windows-safe)");
    assert.deepEqual(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2), ["-c:v", "libx264"]);
  });
  it("mixes a background bed when given; NVENC args when chosen", () => {
    const { args } = assembleArgs({ ...base, bgm: "bgm.mp3", voiceSeconds: 10 }, "h264_nvenc");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    assert.match(fc, /amix=inputs=2/);
    assert.ok(args.includes("-stream_loop"));
    assert.ok(args.includes("h264_nvenc"));
    assert.match(fc, /atempo=1\.000/);
  });
});

describe("ffmpeg assembly (real ffmpeg)", { skip: hasFfmpeg ? false : "ffmpeg/ffprobe not on PATH" }, () => {
  it("renders a 15 s 1080×1920 ad with subtitles, QR end card, voice and bed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gk-ff-"));
    const gen = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { cwd: dir });
    for (let i = 0; i < 3; i += 1) gen(["-f", "lavfi", "-i", `testsrc=size=480x832:rate=16:duration=${2 + i}`, "-pix_fmt", "yuv420p", `clip_${i}.mp4`]);
    gen(["-f", "lavfi", "-i", "sine=frequency=220:duration=13", "voice.flac"]);
    gen(["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "bgm.mp3"]);
    await writeFile(path.join(dir, "qr.png"), await QRCode.toBuffer("https://kart.guma.one/simply-sweet", { width: 300 }));
    await writeFile(
      path.join(dir, "subs.ass"),
      buildAss({ cues: kineticCues([{ start: 0.1, end: 6, text: "Uy wait lang! ₱299 lang po" }, { start: 6, end: 11, text: "Order na sa link!" }]), endCard: { start: 12, end: 15, lines: ["Simply Sweet", "kart.guma.one/simply-sweet"] }, font: "DejaVu Sans" })
    );
    const clipSeconds = await Promise.all([0, 1, 2].map((i) => probeDuration("ffmpeg", `clip_${i}.mp4`, dir)));
    const res = await assembleVideo(
      "ffmpeg",
      dir,
      {
        clips: clipSeconds.map((c, i) => ({ file: `clip_${i}.mp4`, seconds: [4, 6, 5][i]!, clipSeconds: c })),
        voice: "voice.flac",
        voiceSeconds: await probeDuration("ffmpeg", "voice.flac", dir),
        bgm: "bgm.mp3",
        qrPng: "qr.png",
        ass: "subs.ass",
        durationSec: 15,
        endCardSec: 3,
        output: "final.mp4",
      },
      "libx264"
    );
    assert.equal(res.encoder, "libx264");
    const dur = await probeDuration("ffmpeg", "final.mp4", dir);
    assert.ok(Math.abs(dur - 15) < 0.25, `duration ${dur}`);
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", "final.mp4"], { cwd: dir }).toString();
    assert.match(streams, /video,1080,1920|1080,1920,video/);
    assert.match(streams, /audio/);
    await thumbnail("ffmpeg", dir, "final.mp4", "thumbnail.jpg");
    assert.ok(spawnSync("ffprobe", ["-v", "error", "thumbnail.jpg"], { cwd: dir }).status === 0);
  });
});
