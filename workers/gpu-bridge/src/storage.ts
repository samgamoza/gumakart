import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { HttpError } from "./circuit-breaker";

/** Where rendered media lands. S3-compatible covers Cloudflare R2 and MinIO. */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export class S3Storage implements ObjectStorage {
  private readonly client: AwsClient;
  constructor(
    private readonly opts: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl: string; fetch?: typeof fetch }
  ) {
    this.client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, region: opts.region, service: "s3" });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const url = `${this.opts.endpoint.replace(/\/+$/, "")}/${this.opts.bucket}/${encodeKey(key)}`;
    const signed = await this.client.sign(url, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" },
    });
    const res = await (this.opts.fetch ?? fetch)(signed);
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
    return `${this.opts.publicBaseUrl.replace(/\/+$/, "")}/${encodeKey(key)}`;
  }
}

/** Dev/test only: writes under a local folder and returns file:// URLs. */
export class LocalStorage implements ObjectStorage {
  constructor(private readonly dir: string) {}
  async put(key: string, bytes: Uint8Array, _contentType?: string): Promise<string> {
    const target = path.resolve(this.dir, key);
    if (!target.startsWith(path.resolve(this.dir) + path.sep)) throw new Error(`refusing to write outside ${this.dir}: ${key}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return `file://${target}`;
  }
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** ai-media/<tenant>/<job>/<n>-<safe filename> — tenant first so a bucket policy can scope it. */
export function mediaObjectKey(tenantId: string, jobId: string, index: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "output";
  return `ai-media/${tenantId}/${jobId}/${index}-${safe}`;
}
