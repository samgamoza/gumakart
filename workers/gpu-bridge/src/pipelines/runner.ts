import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNodeFailure } from "../circuit-breaker";
import type { ComfyOutputFile, ComfyWorkflow } from "../comfy-client";
import type { PipelineContext } from "./types";

export interface GraphResult {
  file: ComfyOutputFile;
  bytes: Uint8Array;
  contentType: string;
}

/** Submit a graph, wait for it, download every output — all through the ComfyUI breaker. */
export async function runGraph(ctx: PipelineContext, graph: ComfyWorkflow, clientId: string): Promise<GraphResult[]> {
  const promptId = await ctx.comfyBreaker.run(() => ctx.comfy.submit(graph, clientId), isNodeFailure);
  const files = await ctx.comfyBreaker.run(
    () => ctx.comfy.waitForOutputs(promptId, { intervalMs: ctx.cfg.COMFY_POLL_INTERVAL_MS, timeoutMs: ctx.cfg.COMFY_JOB_TIMEOUT_MS, onTick: ctx.heartbeat }),
    isNodeFailure
  );
  const out: GraphResult[] = [];
  for (const file of files) {
    const { bytes, contentType } = await ctx.comfyBreaker.run(() => ctx.comfy.download(file), isNodeFailure);
    out.push({ file, bytes, contentType });
  }
  return out;
}

/** Upload seller media into ComfyUI's input folder. */
export function uploadToComfy(ctx: PipelineContext, bytes: Uint8Array, filename: string, contentType: string): Promise<string> {
  return ctx.comfyBreaker.run(() => ctx.comfy.uploadInput(bytes, filename, contentType), isNodeFailure);
}

/**
 * Step cache: `produce` runs only if `name` isn't in the job folder yet. A retry after a crash or
 * an offline park resumes from the last finished step instead of re-rendering everything.
 */
export async function cachedStep(ctx: PipelineContext, name: string, produce: () => Promise<Uint8Array>): Promise<string> {
  await mkdir(ctx.workDir, { recursive: true });
  const file = path.join(ctx.workDir, name);
  if (existsSync(file)) {
    ctx.log.info("step cached — skipping", { step: name });
    return name;
  }
  const bytes = await produce();
  await writeFile(file + ".part", bytes);
  const { rename } = await import("node:fs/promises");
  await rename(file + ".part", file);
  return name;
}

export async function readStep(ctx: PipelineContext, name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(ctx.workDir, name)));
}

export function extensionFor(contentType: string, fallback: string): string {
  return (
    ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/mpeg": "mp3", "audio/ogg": "ogg" } as Record<string, string>)[contentType] ??
    fallback
  );
}
