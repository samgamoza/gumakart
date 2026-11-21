import { HttpError } from "./circuit-breaker";

/**
 * Downloads seller-provided media (product photos, voice samples) for the pipelines.
 * The bridge runs on the home LAN, so URLs from job payloads are only fetched from an allowlist
 * of hosts (SSRF guard), over https, without following redirects, with a size cap.
 */
export class SourceMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceMediaError";
  }
}

export interface SourceFetcherOptions {
  allowedHosts: string[];
  baseUrl: string;
  maxBytes: number;
  fetch?: typeof fetch;
  /** Tests run a local http server; production is https-only. */
  allowHttp?: boolean;
}

export function parseHostList(list: string): string[] {
  return list
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
}

export class SourceFetcher {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: SourceFetcherOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  resolve(input: string): URL {
    let url: URL;
    try {
      url = new URL(input, this.opts.baseUrl);
    } catch {
      throw new SourceMediaError(`not a URL: ${input.slice(0, 120)}`);
    }
    const protoOk = url.protocol === "https:" || (this.opts.allowHttp === true && url.protocol === "http:");
    if (!protoOk) throw new SourceMediaError(`source media must be https: ${url.protocol}`);
    if (url.username || url.password) throw new SourceMediaError("credentials in source URL are not allowed");
    const hostPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    if (!hostAllowed(url.hostname, this.opts.allowedHosts) && !hostAllowed(hostPort, this.opts.allowedHosts)) {
      throw new SourceMediaError(`source host not allowed: ${url.hostname}`);
    }
    return url;
  }

  async get(input: string, expect: "image" | "audio"): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
    const url = this.resolve(input);
    const res = await this.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (res.status >= 300 && res.status < 400) throw new SourceMediaError(`source media redirected (${res.status}); not following`);
    if (res.status >= 400 && res.status < 500) throw new SourceMediaError(`source media unavailable (HTTP ${res.status}) — re-upload the file`);
    if (!res.ok) throw new HttpError(res.status, url.toString(), await res.text().catch(() => ""));
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > this.opts.maxBytes) throw new SourceMediaError(`source media too large (${declared} bytes)`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > this.opts.maxBytes) throw new SourceMediaError(`source media too large (${buf.byteLength} bytes)`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const sniffed = sniffType(buf);
    // Images must be a format we can verify by magic bytes (PNG / JPEG / WebP).
    const kind = expect === "image" ? sniffed ?? "unknown" : sniffed ?? contentType;
    if (expect === "image" && !kind.startsWith("image/")) throw new SourceMediaError(`expected a JPG, PNG or WebP image, got ${sniffed ?? (contentType || "unknown")}`);
    if (expect === "audio" && !kind.startsWith("audio/")) throw new SourceMediaError(`expected audio, got ${kind || "unknown"}`);
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "source").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
    return { bytes: buf, contentType: sniffed ?? contentType, filename };
  }
}

/** Magic-byte sniffing — never trust a remote content-type alone. */
export function sniffType(b: Uint8Array): string | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (b.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (b.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (b.length >= 3 && (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0))) return "audio/mpeg";
  if (b.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    return /M4A |M4B /.test(brand) ? "audio/mp4" : "video/mp4";
  }
  return null;
}

/** Width/height from PNG, JPEG or WebP headers (no image library needed). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const type = sniffType(b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "image/png" && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (type === "image/jpeg") {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      const len = dv.getUint16(o + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  if (type === "image/webp" && b.length >= 30) {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return { width: w, height: h };
    }
  }
  return null;
}
