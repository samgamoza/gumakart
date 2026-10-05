import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  can,
  canOpenPage,
  canUseApi,
  homeFor,
  permissionForApi,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  shopRoleOf,
} from "./staff-permissions";

const ID = "4f1c2b3a-0000-4000-8000-000000000001";

describe("roles", () => {
  it("owner has every permission; cashier only POS", () => {
    for (const p of PERMISSIONS) assert.ok(can("owner", p), p);
    assert.deepEqual([...ROLE_PERMISSIONS.cashier], ["pos.use"]);
  });

  it("manager runs the shop but not billing, payment settings or staff", () => {
    for (const p of ["orders.payments", "orders.refund", "products.edit", "stock.adjust", "settings.shop", "activity.view"] as const) {
      assert.ok(can("manager", p), p);
    }
    for (const p of ["billing.manage", "settings.payments", "staff.manage"] as const) assert.ok(!can("manager", p), p);
  });

  it("staff can pack and sell but not touch money or prices", () => {
    for (const p of ["orders.fulfil", "links.manage", "pos.use", "messages.reply"] as const) assert.ok(can("staff", p), p);
    for (const p of ["orders.payments", "orders.cancel", "orders.refund", "products.edit", "stock.adjust", "settings.shop", "activity.view"] as const) {
      assert.ok(!can("staff", p), p);
    }
  });

  it("shopRoleOf: owners and support act as owner; staff need a valid staff_role", () => {
    assert.equal(shopRoleOf({ role: "seller_owner" }), "owner");
    assert.equal(shopRoleOf({ role: "super_admin", supportAccess: true }), "owner");
    assert.equal(shopRoleOf({ role: "seller_staff", staffRole: "cashier" }), "cashier");
    assert.equal(shopRoleOf({ role: "seller_staff", staffRole: null }), null);
    assert.equal(shopRoleOf({ role: "seller_staff", staffRole: "admin" }), null);
    assert.equal(shopRoleOf({ role: "customer" }), null);
  });
});

describe("API guard", () => {
  it("money endpoints need the money permission", () => {
    assert.equal(permissionForApi(`/api/orders/${ID}/confirm-payment`, "POST"), "orders.payments");
    assert.equal(permissionForApi(`/api/orders/${ID}/refund`, "POST"), "orders.refund");
    assert.ok(!canUseApi("staff", `/api/orders/${ID}/confirm-payment`, "POST"));
    assert.ok(canUseApi("manager", `/api/orders/${ID}/refund`, "POST"));
  });

  it("after-sale: staff add notes and print slips; edits and returns are manager work", () => {
    assert.ok(canUseApi("staff", `/api/orders/${ID}/notes`, "PATCH"));
    assert.ok(canUseApi("staff", "/api/orders/slips", "GET"));
    assert.ok(!canUseApi("staff", `/api/orders/${ID}/edit`, "POST"));
    assert.ok(!canUseApi("staff", `/api/orders/${ID}/returns`, "POST"));
    assert.ok(canUseApi("manager", `/api/orders/${ID}/edit`, "POST"));
    assert.ok(canUseApi("manager", "/api/bir/z", "POST"));
    assert.ok(!canUseApi("staff", "/api/bir/status", "GET"));
  });

  it("staff can read products but not change them", () => {
    assert.ok(canUseApi("staff", "/api/products", "GET"));
    assert.ok(!canUseApi("staff", "/api/products", "POST"));
    assert.ok(!canUseApi("staff", `/api/products/${ID}`, "PATCH"));
    assert.ok(!canUseApi("staff", `/api/products/${ID}/variants`, "PUT"));
    assert.ok(canUseApi("staff", `/api/products/${ID}/variants`, "GET"));
    assert.ok(!canUseApi("staff", "/api/inventory/count", "POST"));
  });

  it("cashiers reach only the register", () => {
    assert.ok(canUseApi("cashier", "/api/pos/sales", "POST"));
    assert.ok(canUseApi("cashier", "/api/auth/logout", "POST"));
    for (const [p, m] of [
      ["/api/orders", "GET"],
      ["/api/products", "GET"],
      ["/api/dashboard/today", "GET"],
      ["/api/pos-staff", "GET"],
      ["/api/pos/device", "POST"],
    ] as const) {
      assert.ok(!canUseApi("cashier", p, m), p);
    }
  });

  it("billing, payouts and staff are owner-only", () => {
    for (const [p, m] of [
      ["/api/wallet/payout", "POST"],
      ["/api/billing/upgrade", "POST"],
      ["/api/staff", "POST"],
      [`/api/staff/${ID}`, "DELETE"],
      ["/api/onboarding/payments", "POST"],
    ] as const) {
      assert.ok(!canUseApi("manager", p, m), p);
      assert.ok(canUseApi("owner", p, m), p);
    }
  });

  it("an unknown route is owner-only (safe default)", () => {
    assert.equal(permissionForApi("/api/brand-new-thing", "POST"), "owner");
    assert.ok(!canUseApi("manager", "/api/brand-new-thing", "GET"));
    assert.ok(canUseApi("owner", "/api/brand-new-thing", "GET"));
  });

  it("no role gets in without a role", () => {
    assert.ok(!canUseApi(null, "/api/auth/session", "GET"));
  });
});

describe("pages", () => {
  it("cashiers land on POS; others on the dashboard", () => {
    assert.equal(homeFor("cashier"), "/pos");
    assert.equal(homeFor("staff"), "/");
    assert.ok(!canOpenPage("cashier", "/"));
    assert.ok(canOpenPage("cashier", "/pos"));
    assert.ok(canOpenPage("cashier", "/settings/account"));
  });

  it("staff see orders but not settings; managers see settings but not staff", () => {
    assert.ok(canOpenPage("staff", "/orders"));
    assert.ok(!canOpenPage("staff", "/settings/shop"));
    assert.ok(canOpenPage("manager", "/settings/shop"));
    assert.ok(!canOpenPage("manager", "/settings/staff"));
    assert.ok(!canOpenPage("manager", "/settings/wallet"));
    assert.ok(canOpenPage("manager", "/settings/activity"));
    assert.ok(!canOpenPage("staff", "/somewhere-new"));
  });
});
