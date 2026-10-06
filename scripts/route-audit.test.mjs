/**
 * Phase 19 — route auth audit (no dependencies: `node --test scripts/route-audit.test.mjs`).
 *
 * Fails the build when a route ships without a guard:
 *  - admin: every exported handler of every app/api route calls an auth guard (directly or through
 *    a same-file helper), unless it's on PUBLIC below with a reason. Comments don't count.
 *  - web (buyer site): every write handler (POST/PUT/PATCH/DELETE) is rate-limited, signed, or
 *    needs a Guma ID buyer; /api/id/* reads need a buyer too.
 *  - ops: every server action calls the super-admin guard, and every page except /login does.
 *
 * Adding a deliberately public route? Put it in PUBLIC with the reason — that's the review.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === ".next" || name.startsWith(".open-next")) continue;
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(name)) out.push(p);
  }
  return out;
}

/** Drop comments so a guard named in a comment doesn't count. Strings with "//" (URLs) survive. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function matchClose(src, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Body text of a function whose name starts at `at` (handles `({ params }: …)` parameter lists). */
function bodyFrom(src, at) {
  const paren = src.indexOf("(", at);
  const paramsEnd = matchClose(src, paren, "(", ")");
  if (paramsEnd < 0) return "";
  // The body's "{" is the first one outside a return type's generics (Promise<A & { b: c }>).
  let brace = -1;
  for (let i = paramsEnd + 1, angle = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "<") angle++;
    else if (ch === ">" && src[i - 1] !== "=") angle = Math.max(0, angle - 1);
    else if (ch === "{" && angle === 0) {
      brace = i;
      break;
    }
  }
  const arrow = src.indexOf("=>", paramsEnd);
  if (brace < 0) return "";
  // Arrow function with an expression body.
  if (arrow >= 0 && arrow < brace && src.slice(arrow + 2, brace).trim() !== "") {
    const end = src.indexOf(";", arrow);
    return src.slice(arrow, end < 0 ? undefined : end);
  }
  const end = matchClose(src, brace, "{", "}");
  return end < 0 ? "" : src.slice(brace, end + 1);
}

function localFunctions(src) {
  const fns = new Map();
  const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  for (let m; (m = re.exec(src)); ) {
    const name = m[1] ?? m[2];
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) fns.set(name, bodyFrom(src, m.index));
  }
  return fns;
}

/** Exported HTTP handlers → body (null = re-exported from something else, e.g. `export const { GET } = serve()`). */
function handlers(src) {
  const out = new Map();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g)) out.set(m[1], bodyFrom(src, m.index));
  for (const m of src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g)) out.set(m[1], `${m[2]}(`);
  for (const m of src.matchAll(/export\s+const\s+\{([^}]+)\}\s*=/g)) for (const n of m[1].split(",").map((s) => s.trim())) if (n) out.set(n, null);
  return out;
}

function guardedHandlers(file, guard) {
  const src = stripComments(readFileSync(file, "utf8"));
  const fns = localFunctions(src);
  const guarded = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of fns) {
      if (guarded.has(name)) continue;
      if (guard.test(body) || [...guarded].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body))) {
        guarded.add(name);
        changed = true;
      }
    }
  }
  const result = new Map();
  for (const [method, body] of handlers(src)) {
    result.set(method, body !== null && (guard.test(body) || [...guarded].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body))));
  }
  return result;
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// ─── admin ───────────────────────────────────────────────────────────────────

const ADMIN_GUARD =
  /\b(requireTenantSession|requirePartner|requirePosActor|requirePosOwner|withApi|isCronAuthorized|getSession|getSessionFromRequest|posOwnerOrActor)\s*\(/;

/** Deliberately public admin routes. Each carries its own credential or is harmless. */
const ADMIN_PUBLIC = {
  "apps/admin/app/api/auth/login/route.ts": "login (rate limited)",
  "apps/admin/app/api/auth/signup/route.ts": "signup — needs the emailed-code ticket",
  "apps/admin/app/api/auth/signup/start/route.ts": "emails a signup code (rate limited)",
  "apps/admin/app/api/auth/signup/verify/route.ts": "checks a signup code (attempt-limited)",
  "apps/admin/app/api/auth/check-slug/route.ts": "is a shop URL free",
  "apps/admin/app/api/auth/google/route.ts": "starts Google sign-in",
  "apps/admin/app/api/auth/google/callback/route.ts": "Google OAuth callback (state checked)",
  "apps/admin/app/api/auth/support-access/route.ts": "exchanges a signed 5-minute ops grant token",
  "apps/admin/app/api/auth/password/forgot/route.ts": "emails a reset code; same answer for every email",
  "apps/admin/app/api/auth/password/reset/route.ts": "the emailed reset code is the credential",
  "apps/admin/app/api/partners/signup/route.ts": "partner signup — needs the emailed-code ticket",
  "apps/admin/app/api/partners/code/route.ts": "agency name for a partner code (rate limited)",
  "apps/admin/app/api/invite/route.ts": "staff invite — the token in the link is the credential",
  "apps/admin/app/api/pos/login/route.ts": "cashier PIN unlock on a paired register",
  "apps/admin/app/api/webhooks/meta/route.ts": "Meta webhook — X-Hub-Signature-256 checked",
  "apps/admin/app/api/inngest/route.ts": "Inngest — signed with INNGEST_SIGNING_KEY by the SDK",
  "apps/admin/app/api/v1/openapi.json/route.ts": "public API spec",
  "apps/admin/app/api/health/integrations/route.ts": "behind the session middleware; configured/missing flags only",
  "apps/admin/app/api/health/schema/route.ts": "booleans only (CI pre-deploy check)",
  "apps/admin/app/api/onboarding/categories/route.ts": "behind the session middleware; category list",
  // Single methods (the file's other handlers are still checked):
  "GET apps/admin/app/api/kyc/session/route.ts": "mobile KYC — the signed token in the link is the credential",
  "GET apps/admin/app/api/push/subscribe/route.ts": "returns the public VAPID key only",
};

describe("admin API routes have an auth guard", () => {
  const files = walk(path.join(root, "apps/admin/app/api"), (n) => n === "route.ts");
  it("finds the routes", () => assert.ok(files.length > 150, `only ${files.length} routes found`));
  it("every handler is guarded or deliberately public", () => {
    const open = [];
    for (const f of files) {
      const r = rel(f);
      if (ADMIN_PUBLIC[r]) continue;
      for (const [method, ok] of guardedHandlers(f, ADMIN_GUARD)) if (!ok && !ADMIN_PUBLIC[`${method} ${r}`]) open.push(`${method} ${r}`);
    }
    assert.deepEqual(open, [], `handlers without an auth guard:\n  ${open.join("\n  ")}`);
  });
  it("the public list has no stale entries", () => {
    const stale = Object.keys(ADMIN_PUBLIC).filter((p) => !files.map(rel).includes(p.replace(/^[A-Z]+ /, "")));
    assert.deepEqual(stale, []);
  });
});

// ─── web (buyer site) ────────────────────────────────────────────────────────

const WEB_WRITE_GUARD = /\b(rateLimit|requireBuyer|currentBuyer|verify\w*Signature|verify\w*Webhook|isCronAuthorized)\s*\(/;
const WEB_BUYER_GUARD = /\b(requireBuyer|currentBuyer)\s*\(/;

describe("buyer-site API routes", () => {
  const files = walk(path.join(root, "apps/web/app/api"), (n) => n === "route.ts");
  it("every write is rate-limited, signed, or needs a buyer", () => {
    const open = [];
    for (const f of files) {
      for (const [method, ok] of guardedHandlers(f, WEB_WRITE_GUARD)) if (method !== "GET" && method !== "HEAD" && !ok) open.push(`${method} ${rel(f)}`);
    }
    assert.deepEqual(open, [], `unprotected public writes:\n  ${open.join("\n  ")}`);
  });
  it("Guma ID account routes need a signed-in buyer (except sign-in itself)", () => {
    const open = [];
    for (const f of files.filter((p) => rel(p).includes("/api/id/") && !/\/api\/id\/(otp|verify)\//.test(rel(p)))) {
      for (const [method, ok] of guardedHandlers(f, WEB_BUYER_GUARD)) if (!ok) open.push(`${method} ${rel(f)}`);
    }
    assert.deepEqual(open, [], `Guma ID routes without a buyer check:\n  ${open.join("\n  ")}`);
  });
});

// ─── ops console ─────────────────────────────────────────────────────────────

describe("ops console is super-admin only", () => {
  it("every server action calls the guard", () => {
    const files = walk(path.join(root, "apps/platform/app"), (n) => /\.(ts|tsx)$/.test(n)).filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
    const open = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!/\b(guard|requireSuperAdminApi|requireSuperAdmin)\s*\(/.test(bodyFrom(src, m.index))) open.push(`${m[1]} in ${rel(f)}`);
      }
    }
    assert.ok(files.length > 0);
    assert.deepEqual(open, [], `server actions without the super-admin guard:\n  ${open.join("\n  ")}`);
  });
  it("every page except /login calls requireSuperAdmin", () => {
    const pages = walk(path.join(root, "apps/platform/app"), (n) => n === "page.tsx").filter((p) => !rel(p).endsWith("app/login/page.tsx"));
    const open = pages.filter((p) => !/\brequireSuperAdmin\s*\(/.test(stripComments(readFileSync(p, "utf8")))).map(rel);
    assert.deepEqual(open, [], `ops pages without requireSuperAdmin:\n  ${open.join("\n  ")}`);
  });
});

// ─── the audit itself ────────────────────────────────────────────────────────

describe("the audit catches what it should", () => {
  it("comments don't count, helpers do, every method is checked", () => {
    const src = `
      // requireTenantSession() would be nice here
      async function load() { const s = await requireTenantSession(); return s; }
      export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return load(); }
      export async function DELETE() { /* requireTenantSession() */ return 1; }
    `;
    const fns = localFunctions(stripComments(src));
    assert.ok(ADMIN_GUARD.test(fns.get("load")));
    const h = handlers(stripComments(src));
    assert.ok(ADMIN_GUARD.test(h.get("GET")) === false, "GET body itself has no guard");
    assert.equal(ADMIN_GUARD.test(h.get("DELETE")), false, "a commented-out guard is not a guard");
    const typed = "export async function act(id: string): Promise<R & { url?: string }> { const s = await guard(); return s; }";
    assert.match(bodyFrom(typed, 0), /guard\(\)/, "braces in the return type aren't the body");
  });
});
