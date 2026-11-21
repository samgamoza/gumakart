import { HttpError } from "./circuit-breaker";

/**
 * Minimal ComfyUI HTTP client (API format):
 *   POST /prompt {prompt, client_id}        → { prompt_id }
 *   GET  /history/{prompt_id}               → {} while running, then { [id]: { status, outputs } }
 *   GET  /view?filename&subfolder&type      → file bytes
 */
export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface ComfyOutputFile {
  nodeId: string;
  filename: string;
  subfolder: string;
  type: string;
  /** Which output list it came from: images, gifs (VideoHelperSuite videos), audio, … */
  field: string;
  format?: string;
}

export interface ComfyClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class ComfyExecutionError extends Error {
  constructor(message: string, readonly promptId: string) {
    super(message);
    this.name = "ComfyExecutionError";
  }
}

export class ComfyTimeoutError extends Error {
  constructor(readonly promptId: string, timeoutMs: number) {
    super(`ComfyUI prompt ${promptId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "ComfyTimeoutError";
  }
}

export class ComfyClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: ComfyClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    const url = `${this.base}${path}`;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...(this.opts.headers ?? {}), ...((init.headers as Record<string, string>) ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
    return res;
  }

  /** Cheap liveness probe used to close the circuit breaker. */
  async ping(): Promise<void> {
    await this.request("/system_stats", {}, 5_000);
  }

  /**
   * Put a file into ComfyUI's input folder (works for images and audio — LoadImage / LoadAudio
   * read from there). Returns the name to put in the loader node, e.g. "gumakart/abc.png".
   */
  async uploadInput(bytes: Uint8Array, filename: string, contentType: string, subfolder = "gumakart"): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([bytes], { type: contentType }), filename);
    form.append("type", "input");
    form.append("subfolder", subfolder);
    form.append("overwrite", "true");
    const res = await this.request("/upload/image", { method: "POST", body: form }, 120_000);
    const body = (await res.json()) as { name?: string; subfolder?: string };
    if (!body.name) throw new ComfyExecutionError("ComfyUI upload returned no file name", "");
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }

  async submit(workflow: ComfyWorkflow, clientId: string): Promise<string> {
    const res = await this.request("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const body = (await res.json()) as { prompt_id?: string; node_errors?: Record<string, unknown> };
    if (!body.prompt_id) throw new ComfyExecutionError(`ComfyUI rejected the workflow: ${JSON.stringify(body.node_errors ?? body).slice(0, 500)}`, "");
    return body.prompt_id;
  }

  /** Poll /history until the prompt finishes. `onTick` runs each poll (worker heartbeat). */
  async waitForOutputs(
    promptId: string,
    opts: { intervalMs: number; timeoutMs: number; onTick?: () => Promise<void> | void }
  ): Promise<ComfyOutputFile[]> {
    const deadline = this.now() + opts.timeoutMs;
    for (;;) {
      const res = await this.request(`/history/${encodeURIComponent(promptId)}`);
      const history = (await res.json()) as Record<string, ComfyHistoryEntry>;
      const entry = history[promptId];
      if (entry) {
        const status = entry.status;
        if (status?.status_str === "error") {
          throw new ComfyExecutionError(`ComfyUI execution failed: ${summarizeMessages(status.messages)}`, promptId);
        }
        if (status?.completed !== false) return collectOutputs(entry.outputs ?? {});
      }
      if (this.now() >= deadline) throw new ComfyTimeoutError(promptId, opts.timeoutMs);
      await opts.onTick?.();
      await this.sleep(opts.intervalMs);
    }
  }

  async download(file: ComfyOutputFile): Promise<{ bytes: Uint8Array; contentType: string }> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const res = await this.request(`/view?${q.toString()}`, {}, 120_000);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, contentType: res.headers.get("content-type") ?? guessContentType(file.filename) };
  }
}

interface ComfyHistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, Record<string, unknown>>;
}

function summarizeMessages(messages: unknown[] | undefined): string {
  if (!messages) return "unknown error";
  for (const m of messages) {
    if (Array.isArray(m) && m[0] === "execution_error" && m[1] && typeof m[1] === "object") {
      const e = m[1] as { node_type?: string; exception_message?: string };
      return `${e.node_type ?? "node"}: ${e.exception_message ?? "error"}`.slice(0, 500);
    }
  }
  return JSON.stringify(messages).slice(0, 500);
}

/** Every {filename, subfolder, type} in every output list of every node, temp previews excluded. */
export function collectOutputs(outputs: Record<string, Record<string, unknown>>): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = [];
  for (const [nodeId, out] of Object.entries(outputs)) {
    for (const [field, list] of Object.entries(out)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const f = item as { filename?: unknown; subfolder?: unknown; type?: unknown; format?: unknown };
        if (typeof f.filename !== "string") continue;
        const type = typeof f.type === "string" ? f.type : "output";
        if (type === "temp") continue;
        files.push({
          nodeId,
          field,
          filename: f.filename,
          subfolder: typeof f.subfolder === "string" ? f.subfolder : "",
          type,
          format: typeof f.format === "string" ? f.format : undefined,
        });
      }
    }
  }
  return files;
}

export function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      wav: "audio/wav",
      mp3: "audio/mpeg",
      flac: "audio/flac",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

export function mediaKind(contentType: string): "image" | "video" | "audio" | "other" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "other";
}
