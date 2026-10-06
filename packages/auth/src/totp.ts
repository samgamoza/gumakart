/**
 * Phase 21: authenticator-app codes (TOTP, RFC 6238) and backup codes.
 *
 * Pure WebCrypto, so it runs the same in Node, the Cloudflare Workers runtime and tests.
 * Codes: HMAC-SHA1, 30-second steps, 6 digits — what Google Authenticator, Microsoft
 * Authenticator, Authy, 1Password etc. all default to. We accept the step before and after
 * the current one (phone clocks drift) and never the same step twice (replay).
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new 160-bit secret, base32 (what the authenticator app stores). */
export function generateTotpSecret(): string {
  return base32Encode(globalThis.crypto.getRandomValues(new Uint8Array(20)));
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** The 6-digit code for one 30-second step. */
export async function totpCodeAt(secretBase32: string, step: number): Promise<string> {
  const key = await subtle().importKey("raw", base32Decode(secretBase32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new Uint8Array(8);
  let c = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await subtle().sign("HMAC", key, counter));
  const offset = mac[mac.length - 1]! & 15;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Only digits, so "123 456" and "123-456" work. */
export function normalizeOtp(code: string): string {
  return code.replace(/\D/g, "");
}

/**
 * The matching step for this code (current ±1), or null. Steps at or before `lastStep` are
 * refused, so a code that already signed someone in can't be used again.
 */
export async function matchTotp(
  secretBase32: string,
  code: string,
  opts: { nowMs?: number; lastStep?: number | null; window?: number } = {}
): Promise<number | null> {
  const digits = normalizeOtp(code);
  if (digits.length !== DIGITS) return null;
  const now = totpStep(opts.nowMs);
  const window = opts.window ?? 1;
  let found: number | null = null;
  // Check every candidate (no early exit) so timing doesn't reveal which step matched.
  for (let s = now - window; s <= now + window; s++) {
    const expected = await totpCodeAt(secretBase32, s);
    if (timingSafeEqual(expected, digits) && (opts.lastStep == null || s > opts.lastStep)) found = s;
  }
  return found;
}

/** otpauth:// link the authenticator app reads from the QR code. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ─── backup codes ────────────────────────────────────────────────────────────

const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

/** Ten single-use codes like "k7dm-2xqp" (~45 bits each). Shown once; only hashes are stored. */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let n = 0; n < count; n++) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
    let s = "";
    for (const b of bytes) s += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    codes.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
  }
  return codes;
}

export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A backup code looks like 8 letters/digits (with or without the dash); an app code is 6 digits. */
export function looksLikeBackupCode(code: string): boolean {
  return normalizeBackupCode(code).length === 8;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── keys (derived from AUTH_SECRET, or TOTP_ENCRYPTION_KEY when set) ────────

function rootSecret(): string {
  const s =
    process.env.TOTP_ENCRYPTION_KEY?.trim() ||
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV === "development" ? "dev-only-gumakart-auth-secret-min-32-chars" : "");
  if (!s || s.length < 32) throw new Error("AUTH_SECRET (or TOTP_ENCRYPTION_KEY) is missing or too short.");
  return s;
}

async function derivedKey(label: string) {
  const digest = await subtle().digest("SHA-256", enc.encode(`gumakart:${label}:${rootSecret()}`));
  return new Uint8Array(digest);
}

/** HMAC of a backup code (keyed, so a database leak alone can't brute-force them offline). */
export async function hashBackupCode(code: string): Promise<string> {
  const key = await subtle().importKey("raw", await derivedKey("backup-code"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle().sign("HMAC", key, enc.encode(normalizeBackupCode(code))));
  return base32Encode(mac).toLowerCase();
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey() {
  return subtle().importKey("raw", await derivedKey("totp-secret"), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** "v1.<iv>.<ciphertext>" — the authenticator secret at rest. */
export async function sealTotpSecret(secretBase32: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(secretBase32)));
  return `v1.${toB64(iv)}.${toB64(ct)}`;
}

export async function openTotpSecret(sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unknown sealed secret format");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(), fromB64(ct));
  return new TextDecoder().decode(pt);
}
