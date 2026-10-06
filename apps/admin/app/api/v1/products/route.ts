import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCreateProduct, apiListProducts, clampLimit, decodeCursor } from "@gumakart/db";
import { apiError, enumParam, logApiActivity, withApi } from "@/lib/public-api";

/** GET /api/v1/products — newest first, with variants. Filter: status (draft, active, archived). */
export async function GET(request: Request) {
  return withApi(request, "products:read", async (p) => {
    const url = new URL(request.url);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);
    if (rawCursor && !cursor) return apiError(400, "invalid_request", "cursor is not valid. Use next_cursor from the previous page.");
    return NextResponse.json(
      await apiListProducts(p.tenantId, {
        limit: clampLimit(url.searchParams.get("limit")),
        cursor,
        status: enumParam(url, "status", ["draft", "active", "archived"] as const),
      })
    );
  });
}

const createSchema = z.object({
  title: z.string().trim().min(2).max(255),
  price: z.number().min(0).max(10_000_000),
  compare_at_price: z.number().min(0).max(10_000_000).nullish(),
  description_html: z.string().max(20_000).nullish(),
  status: z.enum(["draft", "active"]).optional(),
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  sku: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  image_url: z.string().url().max(2048).nullish(),
});

/**
 * POST /api/v1/products — add a simple product (one variant). Defaults to draft so nothing goes
 * live by accident. Products with options (sizes, colours) are set up in the dashboard.
 */
export async function POST(request: Request) {
  return withApi(request, "products:write", async (p) => {
    const body = createSchema.parse(await request.json());
    const product = await apiCreateProduct(p.tenantId, body);
    await logApiActivity(p, { action: "product.api_created", entityType: "product", entityId: product.id, summary: `Added ${product.title} through the API` });
    return NextResponse.json({ data: product }, { status: 201 });
  });
}
