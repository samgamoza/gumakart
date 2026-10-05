/**
 * Phase 13 — seal channel access tokens (Facebook Page, Shopee, Lazada) before they go in
 * the database. AES-256-GCM via WebCrypto (works on Workers and Node 18+).
 *
 * Key: CHANNEL_TOKEN_KEY (any long random string), else derived from AUTH_SECRET with a
 * label. Rotating the key makes old tokens unreadable → the shop reconnects the channel.
 */

const LABEL = "gumakart:channel-tokens:v1";

function keyMaterial(): string {
  const explicit = process.env.CHANNEL_TOKEN_KEY?.trim();
  if (explicit && explicit.length >= 32) return explicit;
  const auth = process.env.AUTH_SECRET?.trim();
  if (auth && auth.length >= 32) return `${LABEL}:${auth}`;
  if (process.env.NODE_ENV !== "production") return `${LABEL}:local-dev-only-key`;
  throw new Error("CHANNEL_TOKEN_KEY (or AUTH_SECRET) is required to store channel tokens.");
}

type AesKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
let cached: { material: string; key: AesKey } | null = null;

async function aesKey(): Promise<AesKey> {
  const material = keyMaterial();
  if (cached?.material === material) return cached.key;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  cached = { material, key };
  return key;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sealToken(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

/** Null when the value can't be opened (wrong key, tampered, empty). */
export async function openToken(sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await aesKey(), unb64url(ct));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
