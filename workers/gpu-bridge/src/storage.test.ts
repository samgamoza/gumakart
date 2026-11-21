import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalStorage, mediaObjectKey, S3Storage } from "./storage";

describe("storage", () => {
  it("object keys are tenant-scoped and sanitised", () => {
    assert.equal(mediaObjectKey("t1", "j1", 0, "../../etc/passwd"), "ai-media/t1/j1/0-.._.._etc_passwd");
    assert.equal(mediaObjectKey("t1", "j1", 2, "Flux Studio 1080x1920.png"), "ai-media/t1/j1/2-Flux_Studio_1080x1920.png");
  });

  it("local driver writes inside its folder only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gk-media-"));
    const s = new LocalStorage(dir);
    const url = await s.put("ai-media/t/j/0-a.png", new Uint8Array([7]), "image/png");
    assert.deepEqual([...(await readFile(new URL(url)))], [7]);
    await assert.rejects(s.put("../escape.png", new Uint8Array([1]), "image/png"), /outside/);
  });

  it("s3 driver signs a PUT to the bucket and returns the public URL", async () => {
    let seen: Request | undefined;
    const s = new S3Storage({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "guma-media",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      publicBaseUrl: "https://media.guma.one/",
      fetch: (async (req: Request) => {
        seen = req;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    const url = await s.put("ai-media/t/j/0-a b.png", new Uint8Array([1, 2]), "image/png");
    assert.equal(url, "https://media.guma.one/ai-media/t/j/0-a%20b.png");
    assert.equal(seen!.method, "PUT");
    assert.equal(seen!.url, "https://acct.r2.cloudflarestorage.com/guma-media/ai-media/t/j/0-a%20b.png");
    assert.match(seen!.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 Credential=AKIA\//);
  });
});
