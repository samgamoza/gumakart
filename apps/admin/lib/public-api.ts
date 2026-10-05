import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ApiInputError,
  authenticateApiToken,
  hasScope,
  logActivity,
  type ApiPrincipal,
  type ApiScope,
} from "@gumakart/db";
import { rateLimit } from "@gumakart/services";

/**
 * Phase 15 — the public REST API (/api/v1). Server-to-server only: a shop API key in
 * `Authorization: Bearer gk_live_…`, never cookies. 120 requests per minute per key.
 *
 * Responses: `{ data, next_cursor? }` on success, `{ error: { code, message, details? } }`
 * on failure, with the usual HTTP status codes.
 */

export const API_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;

export function apiError(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status, headers });
}

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() ?? null;
}

export function apiActor(p: ApiPrincipal) {
  return { userId: null, name: `API · ${p.tokenName}`.slice(0, 80), role: "api" };
}

export async function logApiActivity(p: ApiPrincipal, input: Parameters<typeof logActivity>[2]): Promise<void> {
  await logActivity(p.tenantId, apiActor(p), input);
}

/**
 * Wraps a /api/v1 handler: authenticates the key, checks the scope, rate-limits per key and
 * turns known errors into the API's error shape.
 */
export async function withApi(
  request: Request,
  scope: ApiScope | null,
  handler: (principal: ApiPrincipal) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const token = bearer(request);
    if (!token) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer gk_live_…");
    const principal = await authenticateApiToken(token);
    if (!principal) return apiError(401, "unauthorized", "This API key is invalid, revoked or expired.");
    const limit = await rateLimit(`api:${principal.tokenId}`, API_RATE_LIMIT);
    const rlHeaders = { "X-RateLimit-Limit": String(API_RATE_LIMIT.limit), "X-RateLimit-Remaining": String(limit.remaining) };
    if (!limit.allowed) {
      return apiError(429, "rate_limited", `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.`, undefined, {
        ...rlHeaders,
        "Retry-After": String(Math.max(1, limit.retryAfterSeconds)),
      });
    }
    if (scope && !hasScope(principal.scopes, scope)) {
      return apiError(403, "missing_scope", `This key needs the "${scope}" permission.`, undefined, rlHeaders);
    }
    const res = await handler(principal);
    for (const [k, v] of Object.entries(rlHeaders)) res.headers.set(k, v);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(400, "invalid_request", error.errors[0]?.message ?? "Invalid request.", error.errors.slice(0, 10).map((e) => ({ path: e.path.join("."), message: e.message })));
    }
    if (error instanceof ApiInputError) return apiError(400, "invalid_request", error.message, error.details);
    if (error instanceof SyntaxError) return apiError(400, "invalid_json", "The request body isn't valid JSON.");
    console.error("[api v1]", error);
    return apiError(500, "internal_error", "Something went wrong on our side. Try again.");
  }
}

export function notFound(what: string): NextResponse {
  return apiError(404, "not_found", `${what} not found.`);
}

/** Parses an ISO date query param; throws ApiInputError when present but invalid. */
export function dateParam(url: URL, name: string): Date | null {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiInputError(`${name} must be an ISO date, like 2026-10-01T00:00:00+08:00.`);
  return d;
}

export function enumParam<T extends string>(url: URL, name: string, allowed: readonly T[]): T | null {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  if (!(allowed as readonly string[]).includes(raw)) throw new ApiInputError(`${name} must be one of: ${allowed.join(", ")}.`);
  return raw as T;
}
