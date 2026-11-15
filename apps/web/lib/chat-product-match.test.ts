import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasBuyingIntent, matchProductForMessage } from "./chat-product-match";

const shop = [
  { id: "1", title: "Ube Cheese Pandesal (Box of 6)" },
  { id: "2", title: "Classic Pandesal (Box of 12)" },
  { id: "3", title: "Leche Flan" },
];

describe("matchProductForMessage", () => {
  it("finds the product named in the message", () => {
    assert.equal(matchProductForMessage("magkano po yung leche flan?", shop)?.id, "3");
    assert.equal(matchProductForMessage("available pa ube cheese pandesal?", shop)?.id, "1");
  });
  it("returns null when two products match equally", () => {
    assert.equal(matchProductForMessage("pandesal box", shop), null);
  });
  it("returns null when nothing is named", () => {
    assert.equal(matchProductForMessage("hello po, available pa?", shop), null);
    assert.equal(matchProductForMessage("where are you located", shop), null);
  });
  it("needs at least half of the product name", () => {
    assert.equal(matchProductForMessage("do you have cheese?", shop), null);
  });
  it("one-product shop: buying intent alone is enough", () => {
    const one = [{ id: "9", title: "Handmade Soap" }];
    assert.equal(matchProductForMessage("available pa po?", one)?.id, "9");
    assert.equal(matchProductForMessage("how much?", one)?.id, "9");
    assert.equal(matchProductForMessage("what are your store hours", one), null);
  });
  it("ignores punctuation and case", () => {
    assert.equal(matchProductForMessage("LECHE-FLAN!!! mine", shop)?.id, "3");
  });
});

describe("hasBuyingIntent", () => {
  it("spots English and Tagalog buying words", () => {
    assert.equal(hasBuyingIntent("Interested"), true);
    assert.equal(hasBuyingIntent("pabili po"), true);
    assert.equal(hasBuyingIntent("How much is this"), true);
    assert.equal(hasBuyingIntent("good morning"), false);
  });
});
