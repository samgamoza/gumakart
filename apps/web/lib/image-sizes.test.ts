import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_IMAGE_WIDTHS, sizedImageUrl, sizedSrcSet, snapWidth } from "./image-sizes";

describe("Phase 20: image sizes", () => {
  it("snaps to the configured widths (2× for phones), never above the largest", () => {
    assert.equal(snapWidth(36), 128);
    assert.equal(snapWidth(80), 256);
    assert.equal(snapWidth(300), 640);
    assert.equal(snapWidth(5000), 1200);
    assert.deepEqual([...ALL_IMAGE_WIDTHS], [64, 128, 256, 384, 640, 828, 1200]);
  });
  it("seller uploads use ?w=, site images and https photos go through Next, SVG/data stay", () => {
    assert.equal(sizedImageUrl("/uploads/products/t1/a.jpg", 80), "/uploads/products/t1/a.jpg?w=256");
    assert.equal(sizedImageUrl("/products/backpack.png", 80), "/_next/image?url=%2Fproducts%2Fbackpack.png&w=256&q=75");
    assert.match(sizedImageUrl("https://images.unsplash.com/x?w=900", 300), /^\/_next\/image\?url=https%3A%2F%2F.*&w=640&q=75$/);
    assert.equal(sizedImageUrl("/logo.svg", 80), "/logo.svg");
    assert.equal(sizedImageUrl("data:image/png;base64,AA", 80), "data:image/png;base64,AA");
    assert.equal(sizedImageUrl(null, 80), "");
  });
  it("srcset lists allowed widths up to what the slot needs", () => {
    assert.equal(sizedSrcSet("/uploads/products/t1/a.jpg", 300), "/uploads/products/t1/a.jpg?w=128 128w, /uploads/products/t1/a.jpg?w=256 256w, /uploads/products/t1/a.jpg?w=384 384w, /uploads/products/t1/a.jpg?w=640 640w");
    assert.equal(sizedSrcSet("/logo.svg", 300), undefined);
  });
});
