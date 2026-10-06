import { API_SCOPES, API_SCOPE_LABELS, WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@gumakart/db/developer";

/** Phase 15 — OpenAPI 3.1 description of /api/v1 (served at /api/v1/openapi.json). */

const money = { type: "string", pattern: "^-?\\d+\\.\\d{2}$", examples: ["682.30"] };
const ts = { type: "string", format: "date-time" };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const page = (ref: string) => ({
  type: "object",
  required: ["data", "next_cursor"],
  properties: { data: { type: "array", items: { $ref: ref } }, next_cursor: nullable({ type: "string" }) },
});
const one = (ref: string) => ({ type: "object", required: ["data"], properties: { data: { $ref: ref } } });
const json = (schema: Record<string, unknown>) => ({ content: { "application/json": { schema } } });
const errors = {
  "400": { description: "Invalid request", ...json({ $ref: "#/components/schemas/Error" }) },
  "401": { description: "Missing, invalid, revoked or expired key", ...json({ $ref: "#/components/schemas/Error" }) },
  "403": { description: "The key lacks the needed scope", ...json({ $ref: "#/components/schemas/Error" }) },
  "429": { description: "Rate limited (120 requests/minute per key)", ...json({ $ref: "#/components/schemas/Error" }) },
};
const q = (name: string, description: string, schema: Record<string, unknown> = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const paging = [q("limit", "1–100, default 50", { type: "integer", minimum: 1, maximum: 100 }), q("cursor", "next_cursor from the previous page")];

export function openApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Guma Kart API",
      version: "1.0.0",
      description:
        "Read a shop's orders, products, stock and customers, update packing/delivery status and stock. " +
        "Create keys in Guma Kart → API & webhooks (owner only). Money is a string with 2 decimals, in PHP. " +
        "Fields are only ever added, never renamed.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: `Authorization: Bearer gk_live_… Scopes: ${API_SCOPES.map((s) => `${s} (${API_SCOPE_LABELS[s].label})`).join(", ")}.`,
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } },
        },
        Address: {
          type: "object",
          properties: Object.fromEntries(["line1", "line2", "barangay", "city", "province", "postal_code", "notes"].map((k) => [k, nullable({ type: "string" })])),
        },
        OrderItem: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            product_id: nullable({ type: "string", format: "uuid" }),
            variant_id: nullable({ type: "string", format: "uuid" }),
            title: { type: "string" },
            variant_title: nullable({ type: "string" }),
            sku: nullable({ type: "string" }),
            quantity: { type: "integer" },
            returned_quantity: { type: "integer" },
            unit_price: money,
            line_total: money,
          },
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            number: { type: "string" },
            created_at: ts,
            paid_at: nullable(ts),
            completed_at: nullable(ts),
            cancelled_at: nullable(ts),
            voided_at: nullable(ts),
            order_state: { type: "string", enum: ["open", "completed", "cancelled"] },
            payment_state: { type: "string", enum: ["unpaid", "pending_verification", "paid", "cod_due", "failed", "refunded", "partially_refunded"] },
            fulfillment_state: { type: "string", enum: ["unfulfilled", "ready", "booked", "picked_up", "out_for_delivery", "delivered", "failed_delivery", "returned"] },
            channel: nullable({ type: "string" }),
            payment_method: nullable({ type: "string" }),
            delivery_type: nullable({ type: "string" }),
            buyer: { type: "object", properties: { name: nullable({ type: "string" }), phone: nullable({ type: "string" }), email: nullable({ type: "string" }), customer_id: nullable({ type: "string", format: "uuid" }) } },
            shipping_address: nullable({ $ref: "#/components/schemas/Address" }),
            currency: { type: "string", const: "PHP" },
            subtotal: money,
            discount: money,
            delivery_fee: money,
            tax: money,
            total: money,
            refunded: money,
            coupon_code: nullable({ type: "string" }),
            note: nullable({ type: "string" }),
            tags: { type: "array", items: { type: "string" } },
            invoice_number: nullable({ type: "string" }),
            external_order_id: nullable({ type: "string" }),
            items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
          },
        },
        Variant: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            product_id: { type: "string", format: "uuid" },
            title: { type: "string" },
            sku: nullable({ type: "string" }),
            barcode: nullable({ type: "string" }),
            price: money,
            compare_at_price: nullable(money),
            stock: { type: "integer" },
            options: { type: "object", additionalProperties: { type: "string" } },
            active: { type: "boolean" },
            image_url: nullable({ type: "string" }),
          },
        },
        StockRow: { allOf: [{ $ref: "#/components/schemas/Variant" }, { type: "object", properties: { product_title: { type: "string" } } }] },
        Product: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            slug: { type: "string" },
            status: { type: "string", enum: ["draft", "active", "archived"] },
            description_html: nullable({ type: "string" }),
            price: money,
            compare_at_price: nullable(money),
            track_inventory: { type: "boolean" },
            options: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } } } },
            images: { type: "array", items: { type: "string" } },
            created_at: ts,
            updated_at: ts,
            variants: { type: "array", items: { $ref: "#/components/schemas/Variant" } },
          },
        },
        Customer: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: nullable({ type: "string" }),
            phone: { type: "string" },
            email: nullable({ type: "string" }),
            sms_marketing: { type: "boolean" },
            orders_count: { type: "integer" },
            total_spent: money,
            first_order_at: nullable(ts),
            last_order_at: nullable(ts),
            created_at: ts,
          },
        },
        WebhookEvent: {
          type: "object",
          description:
            "POSTed to your webhook URL. Headers: Guma-Event, Guma-Event-Id, Guma-Delivery, Guma-Attempt, and " +
            "Guma-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\" with your endpoint secret>.",
          properties: {
            id: { type: "string", format: "uuid" },
            type: { type: "string", enum: [...WEBHOOK_EVENTS, "webhook.test"], description: WEBHOOK_EVENTS.map((e) => `${e}: ${WEBHOOK_EVENT_LABELS[e]}`).join(" ") },
            created_at: ts,
            shop: { type: "object", properties: { id: { type: "string" }, slug: { type: "string" } } },
            data: { type: "object", properties: { object: { description: "An Order, StockRow, Customer or Product, as the API returns it." } } },
          },
        },
      },
    },
    paths: {
      "/shop": { get: { summary: "The shop this key belongs to, and the key's scopes", responses: { "200": { description: "OK" }, ...errors } } },
      "/orders": {
        get: {
          summary: "List orders (newest first)",
          "x-scope": "orders:read",
          parameters: [
            q("order_state", "open, completed, cancelled"),
            q("payment_state", "unpaid, pending_verification, paid, cod_due, failed, refunded, partially_refunded"),
            q("fulfillment_state", "unfulfilled, ready, booked, picked_up, out_for_delivery, delivered, failed_delivery, returned"),
            q("channel", "facebook, instagram, messenger, tiktok, shopee, lazada, sms, pos, direct, other"),
            q("created_after", "ISO date-time", ts),
            q("created_before", "ISO date-time", ts),
            ...paging,
          ],
          responses: { "200": { description: "A page of orders", ...json(page("#/components/schemas/Order")) }, ...errors },
        },
      },
      "/orders/{order}": {
        get: {
          summary: "One order by id or order number",
          "x-scope": "orders:read",
          parameters: [{ name: "order", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "The order", ...json(one("#/components/schemas/Order")) }, "404": { description: "Not found" }, ...errors },
        },
      },
      "/orders/{order}/actions": {
        post: {
          summary: "Packing and delivery updates (buyers get the usual SMS/email)",
          "x-scope": "orders:write",
          parameters: [{ name: "order", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["action"],
              properties: {
                action: { type: "string", enum: ["accept", "mark_ready", "mark_out_for_delivery", "mark_delivered", "mark_failed_delivery", "mark_returned"] },
                note: { type: "string", maxLength: 500 },
              },
            }),
          },
          responses: { "200": { description: "The updated order; changed=false when nothing had to change" }, "409": { description: "Not allowed from the order's current state" }, ...errors },
        },
      },
      "/products": {
        get: {
          summary: "List products with variants (newest first)",
          "x-scope": "products:read",
          parameters: [q("status", "draft, active, archived"), ...paging],
          responses: { "200": { description: "A page of products", ...json(page("#/components/schemas/Product")) }, ...errors },
        },
        post: {
          summary: "Add a simple product (one variant). Defaults to draft. Options/variants are set up in the dashboard.",
          "x-scope": "products:write",
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["title", "price"],
              properties: {
                title: { type: "string", minLength: 2, maxLength: 255 },
                price: { type: "number", minimum: 0 },
                compare_at_price: nullable({ type: "number", description: "Higher than price (shown crossed out)" }),
                description_html: nullable({ type: "string" }),
                status: { type: "string", enum: ["draft", "active"], default: "draft" },
                stock: nullable({ type: "integer", minimum: 0 }),
                sku: nullable({ type: "string" }),
                barcode: nullable({ type: "string" }),
                image_url: nullable({ type: "string", format: "uri" }),
              },
            }),
          },
          responses: { "201": { description: "The new product", ...json(one("#/components/schemas/Product")) }, ...errors },
        },
      },
      "/products/{id}": {
        get: {
          summary: "One product",
          "x-scope": "products:read",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "The product", ...json(one("#/components/schemas/Product")) }, "404": { description: "Not found" }, ...errors },
        },
        patch: {
          summary: "Change title, description, price, compare-at price or status (never deletes). Products with options: set prices per variant.",
          "x-scope": "products:write",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: {
                title: { type: "string" },
                description_html: nullable({ type: "string" }),
                price: { type: "number", minimum: 0 },
                compare_at_price: nullable({ type: "number" }),
                status: { type: "string", enum: ["draft", "active", "archived"] },
              },
            }),
          },
          responses: { "200": { description: "The updated product", ...json(one("#/components/schemas/Product")) }, "404": { description: "Not found" }, ...errors },
        },
      },
      "/variants/{id}": {
        patch: {
          summary: "Change a variant's price, compare-at price, SKU or barcode (stock: PUT /inventory)",
          "x-scope": "products:write",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: {
            required: true,
            ...json({
              type: "object",
              properties: {
                price: { type: "number", minimum: 0 },
                compare_at_price: nullable({ type: "number" }),
                sku: nullable({ type: "string" }),
                barcode: nullable({ type: "string" }),
              },
            }),
          },
          responses: { "200": { description: "The updated variant", ...json(one("#/components/schemas/StockRow")) }, "404": { description: "Not found" }, ...errors },
        },
      },
      "/inventory": {
        get: {
          summary: "Stock per variant",
          "x-scope": "inventory:read",
          parameters: [q("sku", "Exact SKU"), q("barcode", "Exact barcode"), ...paging],
          responses: { "200": { description: "A page of variants", ...json(page("#/components/schemas/StockRow")) }, ...errors },
        },
        put: {
          summary: "Set counted stock (all or nothing, up to 500 items)",
          "x-scope": "inventory:write",
          requestBody: {
            required: true,
            ...json({
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  maxItems: 500,
                  items: { type: "object", required: ["stock"], properties: { variant_id: { type: "string", format: "uuid" }, sku: { type: "string" }, stock: { type: "integer", minimum: 0 } } },
                },
              },
            }),
          },
          responses: { "200": { description: "The updated variants" }, ...errors },
        },
      },
      "/customers": {
        get: {
          summary: "List customers (newest first)",
          "x-scope": "customers:read",
          parameters: [q("phone", "Matched on the last 10 digits"), ...paging],
          responses: { "200": { description: "A page of customers", ...json(page("#/components/schemas/Customer")) }, ...errors },
        },
      },
      "/customers/{id}": {
        get: {
          summary: "One customer",
          "x-scope": "customers:read",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "The customer", ...json(one("#/components/schemas/Customer")) }, "404": { description: "Not found" }, ...errors },
        },
      },
    },
    webhooks: {
      event: { post: { summary: "Every webhook event", requestBody: json({ $ref: "#/components/schemas/WebhookEvent" }), responses: { "200": { description: "Reply 2xx within 10 seconds" } } } },
    },
  };
}
