import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostAllowed, imageSize, parseHostList, SourceFetcher, SourceMediaError, sniffType } from "./source-media";

const PNG_1200x800 = (() => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 1200);
  new DataView(b.buffer).setUint32(20, 800);
  return b;
})();
const JPEG_640x480 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0]);

function fetcher(handler: (url: URL, init?: RequestInit) => Response) {
  const seen: string[] = [];
  const f = new SourceFetcher({
    allowedHosts: parseHostList("kart.guma.one, *.public.blob.vercel-storage.com"),
    baseUrl: "https://kart.guma.one",
    maxBytes: 1000,
    fetch: (async (u: URL | string, init?: RequestInit) => {
      seen.push(String(u));
      return handler(new URL(String(u)), init);
    }) as typeof fetch,
  });
  return { f, seen };
}

describe("source media (SSRF guard)", () => {
  it("allowlist with subdomain wildcards", () => {
    const list = parseHostList("kart.guma.one,*.public.blob.vercel-storage.com");
    assert.ok(hostAllowed("kart.guma.one", list));
    assert.ok(hostAllowed("abc123.public.blob.vercel-storage.com", list));
    assert.ok(!hostAllowed("public.blob.vercel-storage.com.evil.io", list));
    assert.ok(!hostAllowed("evilkart.guma.one", list));
    assert.ok(!hostAllowed("192.168.1.15", list));
  });

  it("resolves relative upload paths against the storefront and refuses everything else", async () => {
    const { f, seen } = fetcher(() => new Response(PNG_1200x800, { headers: { "content-type": "image/png" } }));
    const got = await f.get("/uploads/products/t1/a.png", "image");
    assert.equal(seen[0], "https://kart.guma.one/uploads/products/t1/a.png");
    assert.equal(got.contentType, "image/png");
    for (const bad of ["http://kart.guma.one/a.png", "https://192.168.1.15:8188/view?filename=x", "https://user:pw@kart.guma.one/a.png", "file:///etc/passwd", "https://evil.io/a.png"]) {
      await assert.rejects(f.get(bad, "image"), SourceMediaError, bad);
    }
  });

  it("doesn't follow redirects, caps size, sniffs real type, 4xx is permanent", async () => {
    await assert.rejects(fetcher(() => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } })).f.get("/a.png", "image"), /redirected/);
    await assert.rejects(fetcher(() => new Response(new Uint8Array(2000))).f.get("/a.png", "image"), /too large/);
    await assert.rejects(fetcher(() => new Response("<html>", { headers: { "content-type": "image/png" } })).f.get("/a.png", "image"), /expected a JPG, PNG or WebP image/);
    await assert.rejects(fetcher(() => new Response("nope", { status: 404 })).f.get("/a.png", "image"), (e: unknown) => e instanceof SourceMediaError && /404/.test(e.message));
  });

  it("image sizes and sniffing", () => {
    assert.deepEqual(imageSize(PNG_1200x800), { width: 1200, height: 800 });
    assert.deepEqual(imageSize(JPEG_640x480), { width: 640, height: 480 });
    assert.equal(sniffType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ")), "audio/wav");
    assert.equal(sniffType(new TextEncoder().encode("fLaC\0\0")), "audio/flac");
    assert.equal(imageSize(new TextEncoder().encode("GIF89a")), null);
  });
});
