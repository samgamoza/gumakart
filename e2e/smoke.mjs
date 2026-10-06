/**
 * Guma Kart smoke suite (Phase 19) — the money paths, end to end, in a real browser.
 *
 *   1. Seller signs in                       5. Seller accepts the COD order, confirms the GCash one
 *   2. Seller adds a product (API)            6. POS: open shift, sell, receipt
 *   3. Seller makes a pickup checkout link    7. POS: return the sale with a cash refund
 *   4. Buyer orders via the link: COD, then   8. Cleanup: archive the product, turn off the link
 *      GCash with a screenshot as proof
 *
 * Run (local dev):
 *   cd e2e && npm install && npx playwright install chromium     # once
 *   SMOKE_SELLER_EMAIL=… SMOKE_SELLER_PASSWORD=… npm run smoke
 *
 * Env:
 *   SMOKE_ADMIN_URL (default http://localhost:3001)   SMOKE_WEB_URL (default http://localhost:3010)
 *   SMOKE_SELLER_EMAIL / SMOKE_SELLER_PASSWORD        the shop owner of a TEST shop
 *   SMOKE_ALLOW_LIVE=1                                needed for *.guma.one — it creates real orders
 *   SMOKE_HEADED=1                                    watch it run
 *   PW_CHROMIUM=/path/to/chromium                     optional browser binary
 *
 * The shop needs GCash (manual) and pickup turned on. Exit code 0 = every step passed.
 * On a failure a screenshot lands in e2e/out/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
mkdirSync(OUT, { recursive: true });

const ADMIN = (process.env.SMOKE_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
const WEB = (process.env.SMOKE_WEB_URL ?? "http://localhost:3010").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_SELLER_EMAIL;
const PASSWORD = process.env.SMOKE_SELLER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set SMOKE_SELLER_EMAIL and SMOKE_SELLER_PASSWORD (owner of a test shop).");
  process.exit(2);
}
if (/guma\.one/i.test(ADMIN + WEB) && process.env.SMOKE_ALLOW_LIVE !== "1") {
  console.error("Refusing to run against *.guma.one without SMOKE_ALLOW_LIVE=1 — this places real orders. Use a test shop.");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 12);
const results = [];
const state = {};

async function step(name, fn, page) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(error?.message ?? error).split("\n")[0] });
    console.error(`✗ ${name}: ${String(error?.message ?? error).split("\n")[0]}`);
    if (page) await page.screenshot({ path: path.join(OUT, `fail-${results.length}.png`), fullPage: true }).catch(() => null);
    throw error;
  }
}

/** fetch() from inside the signed-in admin page, so the session cookie goes along. */
async function api(page, method, url, body) {
  const res = await page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { method, url, body }
  );
  if (res.status >= 400 || res.json?.ok === false) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.json)?.slice(0, 200)}`);
  return res.json;
}

const browser = await chromium.launch({ headless: process.env.SMOKE_HEADED !== "1", executablePath: process.env.PW_CHROMIUM || undefined });
const seller = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const buyerCtx = await browser.newContext({ viewport: { width: 400, height: 860 } });
const buyer = await buyerCtx.newPage();
for (const c of [seller.context(), buyerCtx]) await c.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());

const note = (m) => process.env.SMOKE_VERBOSE === "1" && console.log(`    · ${m}`);

async function linkOrder(method) {
  note(`open /c/${state.linkCode}`);
  await buyer.goto(`${WEB}/c/${state.linkCode}`, { waitUntil: "networkidle", timeout: 120_000 });
  await buyer.getByPlaceholder("Juan dela Cruz").fill(`Smoke Buyer ${stamp}`);
  await buyer.getByPlaceholder("0917 123 4567").fill("09170000000".slice(0, 7) + stamp.slice(-4));
  // Links that allow both ask first; pickup-only links skip this.
  const pickup = buyer.getByText("Ipi-pickup ko");
  if (await pickup.count()) {
    note("choose pickup");
    await pickup.first().click();
  }
  note(`pay with ${method}`);
  await buyer.getByText(method === "cod" ? /^Cash on (pickup|delivery)$/ : /^GCash$/).first().click();
  note("place order");
  await buyer.getByRole("button", { name: /I-place ang order/ }).last().click();
  await buyer.waitForURL(/\/orders\//, { timeout: 120_000 });
  note(`order page ${new URL(buyer.url()).pathname}`);
  return decodeURIComponent(new URL(buyer.url()).pathname.split("/").pop());
}

let failed = false;
try {
  await step("seller signs in", async () => {
    await seller.goto(`${ADMIN}/login`, { waitUntil: "networkidle", timeout: 120_000 });
    await seller.fill("input[type=email]", EMAIL);
    await seller.fill("input[type=password]", PASSWORD);
    await seller.click("button[type=submit]");
    await seller.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 120_000 });
  }, seller);

  await step("seller adds a product", async () => {
    const r = await api(seller, "POST", "/api/products", {
      title: `SMOKE Soap ${stamp}`,
      basePrice: 120,
      status: "active",
      stockQty: 50,
      descriptionHtml: "<p>Smoke test item — safe to delete.</p>",
    });
    state.product = r.product;
  }, seller);

  await step("seller makes a pickup checkout link", async () => {
    const r = await api(seller, "POST", "/api/checkout-links", { title: `SMOKE ${stamp}`, items: [{ productId: state.product.id, quantity: 1 }], deliveryMode: "pickup" });
    state.linkId = r.link.id;
    state.linkCode = r.link.code;
  }, seller);

  await step("buyer orders via the link (cash on pickup)", async () => {
    state.codOrder = await linkOrder("cod");
  }, buyer);

  await step("buyer orders via the link (GCash) and uploads proof", async () => {
    state.gcashOrder = await linkOrder("gcash");
    const png = path.join(OUT, "proof.png");
    // 1×1 PNG stands in for the GCash screenshot.
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    await buyer.locator('input[type="file"]').first().setInputFiles(png);
    await buyer.getByText(/Replace screenshot|Palitan ang screenshot/).first().waitFor({ timeout: 60_000 });
    await buyer.getByRole("button", { name: /I paid|Nagbayad na ako/ }).click();
    await buyer.getByText(/Proof saved|Na-save ang proof/).waitFor({ timeout: 60_000 });
  }, buyer);

  await step("seller accepts the COD order and confirms the GCash payment", async () => {
    const { orders } = await api(seller, "GET", "/api/orders");
    const find = (n) => orders.find((o) => o.orderNumber === n || o.number === n);
    const cod = find(state.codOrder);
    const gcash = find(state.gcashOrder);
    if (!cod || !gcash) throw new Error(`orders not in the seller's list (${state.codOrder}, ${state.gcashOrder})`);
    await api(seller, "PATCH", `/api/orders/${cod.id}`, { action: "accept" });
    await api(seller, "POST", `/api/orders/${gcash.id}/confirm-payment`, { note: "smoke test" });
    const after = (await api(seller, "GET", "/api/orders")).orders.find((o) => o.id === gcash.id);
    const paid = after?.paymentState ?? after?.payment_state;
    if (paid && paid !== "paid") throw new Error(`GCash order payment state is ${paid}`);
  }, seller);

  await step("POS: open shift, sell, receipt", async () => {
    await seller.goto(`${ADMIN}/pos`, { waitUntil: "networkidle", timeout: 120_000 });
    if (await seller.locator("[data-testid=pos-open-shift]").count()) {
      await seller.locator("input").first().fill("1000");
      await seller.click("[data-testid=pos-open-shift]");
      await seller.waitForTimeout(2000);
    }
    await seller.getByPlaceholder(/Search or scan/).fill(`SMOKE Soap ${stamp}`);
    await seller.locator("[data-testid=pos-product]", { hasText: `SMOKE Soap ${stamp}` }).first().click();
    await seller.click("[data-testid=pos-charge]");
    await seller.locator("[role=dialog] button", { hasText: /^₱/ }).last().click();
    await seller.click("[data-testid=pos-complete]");
    await seller.getByText("SALES INVOICE").or(seller.getByText(/Sale #/)).first().waitFor({ timeout: 60_000 });
    await seller.click("[data-testid=pos-new-sale]");
  }, seller);

  await step("POS: return the sale with a cash refund", async () => {
    await seller.getByRole("button", { name: /Sales/ }).first().click();
    await seller.locator("[role=dialog] li button", { hasText: "#" }).first().click();
    await seller.click("[data-testid=pos-return]");
    await seller.locator("[role=dialog] button[aria-label=More]").first().click();
    await seller.click("[data-testid=pos-return-confirm]");
    await seller.getByText(/^Return on /).first().waitFor({ timeout: 60_000 });
  }, seller);
} catch {
  failed = true;
} finally {
  // Best-effort cleanup so test shops don't fill up with smoke items.
  if (state.linkId) await api(seller, "PATCH", `/api/checkout-links/${state.linkId}`, { active: false }).catch(() => null);
  if (state.product) await api(seller, "PATCH", `/api/products/${state.product.id}`, { status: "archived" }).catch(() => null);
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} steps passed${failed ? " — stopped at the first failure" : ""}.`);
if (state.codOrder) console.log(`Orders: ${state.codOrder} (COD), ${state.gcashOrder ?? "—"} (GCash)`);
writeFileSync(path.join(OUT, "last-run.json"), JSON.stringify({ at: new Date().toISOString(), admin: ADMIN, web: WEB, results, state: { codOrder: state.codOrder, gcashOrder: state.gcashOrder } }, null, 2));
process.exit(failed ? 1 : 0);
