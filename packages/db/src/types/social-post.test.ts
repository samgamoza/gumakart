import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePostReference } from "./social-post";

describe("parsePostReference", () => {
  it("accepts bare and Graph ids", () => {
    assert.deepEqual(parsePostReference(" 1234567890 "), { postId: "1234567890", platform: "unknown" });
    assert.deepEqual(parsePostReference("111222333_444555666"), { postId: "111222333_444555666", platform: "unknown" });
  });
  it("reads Facebook URLs", () => {
    assert.equal(parsePostReference("https://www.facebook.com/simplysweet/posts/pfbid02abc")?.postId, undefined);
    assert.deepEqual(parsePostReference("https://www.facebook.com/simplysweet/posts/123456789012345"), { postId: "123456789012345", platform: "facebook" });
    assert.deepEqual(parsePostReference("https://m.facebook.com/story.php?story_fbid=987654321&id=111222333"), { postId: "111222333_987654321", platform: "facebook" });
    assert.deepEqual(parsePostReference("facebook.com/reel/556677889900"), { postId: "556677889900", platform: "facebook" });
    assert.deepEqual(parsePostReference("https://www.facebook.com/watch/?v=31415926535"), { postId: "31415926535", platform: "facebook" });
  });
  it("reads Instagram and TikTok URLs", () => {
    assert.deepEqual(parsePostReference("https://www.instagram.com/p/C9xYz_AbCd/"), { postId: "C9xYz_AbCd", platform: "instagram" });
    assert.deepEqual(parsePostReference("https://www.tiktok.com/@shop/video/7301234567890123456"), { postId: "7301234567890123456", platform: "tiktok" });
  });
  it("rejects junk", () => {
    assert.equal(parsePostReference(""), null);
    assert.equal(parsePostReference("hello world"), null);
    assert.equal(parsePostReference("https://evil.example/posts/123456789"), null);
  });
});
