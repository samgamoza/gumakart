import { test } from "node:test";
import assert from "node:assert/strict";
import { safeJsonLd } from "../components/storefront/storefront-json-ld";
import { isOptimizableImageSrc } from "./image-hosts";
import storefrontImageLoader from "./image-loader";

/* Security slice G1 (audit 2026-10-07). Run: npx tsx --test lib/security-g1.test.ts */

test("GK-1: JSON-LD cannot break out of its script tag", () => {
  const out = safeJsonLd({ name: 'Shop</script><script>alert("x")</script>', note: "A & B   C" });
  assert.equal(out.includes("</script>"), false);
  assert.equal(out.includes("<"), false);
  assert.equal(out.includes("&"), false);
  // Still valid JSON with the original content.
  const parsed = JSON.parse(out) as { name: string; note: string };
  assert.equal(parsed.name, 'Shop</script><script>alert("x")</script>');
  assert.equal(parsed.note, "A & B   C");
});

test("GK-11: only our hosts go through the image optimiser", () => {
  assert.equal(isOptimizableImageSrc("/uploads/products/t1/a.jpg"), true);
  assert.equal(isOptimizableImageSrc("https://abc123.public.blob.vercel-storage.com/products/t1/a.jpg"), true);
  assert.equal(isOptimizableImageSrc("https://images.unsplash.com/photo-1"), true);
  assert.equal(isOptimizableImageSrc("https://evil.example/huge.jpg"), false);
  assert.equal(isOptimizableImageSrc("http://images.unsplash.com/photo-1"), false);
  assert.equal(isOptimizableImageSrc("//images.unsplash.com/photo-1"), false);
  assert.equal(isOptimizableImageSrc("https://public.blob.vercel-storage.com.evil.example/x.jpg"), false);
  assert.match(storefrontImageLoader({ src: "/uploads/products/t1/a.jpg", width: 640 }), /^\/_next\/image\?url=/);
  assert.equal(storefrontImageLoader({ src: "https://evil.example/huge.jpg", width: 640 }), "https://evil.example/huge.jpg");
});
