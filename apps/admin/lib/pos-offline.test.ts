/**
 * Phase 12b — the register's offline outbox and invoice block (no browser needed:
 * localStorage and fetch are stubbed).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

class MemoryStorage {
  private data = new Map<string, string>();
  full = false;
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}
const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

let lib: typeof import("./pos-offline");
before(async () => {
  lib = await import("./pos-offline");
});

type Handler = (url: string, body: Record<string, unknown>) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    return handler(url, body);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const sale = (key: string) => ({ key, body: { idempotencyKey: key }, receipt: { key }, queuedAt: new Date().toISOString(), attempts: 0 });

beforeEach(() => {
  storage.clear();
  storage.full = false;
});

describe("device id", () => {
  it("is stable and well-formed", () => {
    const a = lib.deviceId();
    assert.match(a, /^[A-Za-z0-9_-]{8,40}$/);
    assert.equal(lib.deviceId(), a);
  });
});

describe("outbox", () => {
  it("queues once per key and survives a reload (it's in storage)", () => {
    assert.equal(lib.enqueue("shop", sale("k1")), true);
    assert.equal(lib.enqueue("shop", sale("k1")), true);
    assert.equal(lib.enqueue("shop", sale("k2")), true);
    assert.deepEqual(lib.outbox("shop").map((s) => s.key), ["k1", "k2"]);
    assert.equal(lib.outbox("other").length, 0, "per shop");
  });

  it("says so when the device can't store the sale", () => {
    storage.full = true;
    assert.equal(lib.enqueue("shop", sale("k1")), false);
    assert.equal(lib.storageWorks(), false);
  });

  it("sends oldest first; stops at no connection and keeps the rest", async () => {
    lib.enqueue("shop", sale("a"));
    lib.enqueue("shop", sale("b"));
    lib.enqueue("shop", sale("c"));
    let n = 0;
    const { f, calls } = fakeFetch(() => {
      n += 1;
      if (n === 2) throw new TypeError("Failed to fetch");
      return json(200, { ok: true, receipt: { orderNumber: "X-1" } });
    });
    const r = await lib.syncOutbox("shop", f);
    assert.equal(r.synced, 1);
    assert.equal(r.stop, "offline");
    assert.deepEqual(calls.map((c) => c.body.idempotencyKey), ["a", "b"]);
    assert.deepEqual(lib.outbox("shop").map((s) => s.key), ["b", "c"]);
    const again = await lib.syncOutbox("shop", fakeFetch(() => json(200, { ok: true, receipt: { syncIssues: 2 } })).f);
    assert.equal(again.synced, 2);
    assert.equal(again.flagged, 2);
    assert.equal(again.remaining, 0);
  });

  it("parked sales leave the device; a locked register keeps them", async () => {
    lib.enqueue("shop", sale("a"));
    lib.enqueue("shop", sale("b"));
    const parked = await lib.syncOutbox("shop", fakeFetch((_, body) => (body.idempotencyKey === "a" ? json(200, { ok: true, parked: true }) : json(401, { ok: false, code: "POS_LOCKED" }))).f);
    assert.equal(parked.parked, 1);
    assert.equal(parked.stop, "locked");
    assert.deepEqual(lib.outbox("shop").map((s) => s.key), ["b"]);
  });

  it("server errors keep the sale and count the attempt", async () => {
    lib.enqueue("shop", sale("a"));
    const r = await lib.syncOutbox("shop", fakeFetch(() => json(500, { ok: false, error: "boom" })).f);
    assert.equal(r.stop, "offline");
    assert.equal(lib.outbox("shop")[0]!.attempts, 1);
    assert.equal(lib.outbox("shop")[0]!.lastError, "boom");
    const html = await lib.syncOutbox("shop", fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 })).f);
    assert.equal(html.stop, "offline");
    assert.equal(lib.outbox("shop").length, 1);
  });
});

describe("BIR invoice block", () => {
  it("reserves once, hands out numbers in order, asks for the next when used up", async () => {
    let id = 0;
    const { f, calls } = fakeFetch((_, body) => {
      id += 1;
      const start = id === 1 ? 101 : 106;
      assert.equal(body.replaceBlockId ?? null, id === 1 ? null : "b1");
      return json(200, { ok: true, block: { id: `b${id}`, prefix: "SI", startNo: start, endNo: start + 4, nextFree: start } });
    });
    const b = await lib.ensureBlock("shop", "si", f);
    assert.equal(lib.blockRemaining(b), 5);
    assert.equal(await lib.ensureBlock("shop", "si", f).then((x) => x?.id), "b1", "no new request while numbers are left");
    assert.equal(calls.length, 1);
    const taken = [1, 2, 3, 4, 5].map(() => lib.takeInvoiceNumber("shop"));
    assert.deepEqual(taken, ["SI0000000101", "SI0000000102", "SI0000000103", "SI0000000104", "SI0000000105"]);
    assert.equal(lib.takeInvoiceNumber("shop"), null, "none left offline");
    const next = await lib.ensureBlock("shop", "si", f);
    assert.equal(next?.id, "b2");
    assert.equal(lib.takeInvoiceNumber("shop"), "SI0000000106");
  });

  it("never goes back behind what the server saw used (storage was cleared)", async () => {
    const f = fakeFetch(() => json(200, { ok: true, block: { id: "b1", prefix: "SI", startNo: 1, endNo: 10, nextFree: 7 } })).f;
    await lib.ensureBlock("shop", "SI", f);
    assert.equal(lib.takeInvoiceNumber("shop"), "SI0000000007");
  });

  it("offline: keeps whatever block it has", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    }).f;
    assert.equal(await lib.ensureBlock("shop", "SI", f), null);
    assert.equal(lib.takeInvoiceNumber("shop"), null);
  });
});
