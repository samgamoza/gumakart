# Phase 33 — palenkeAi harvest: the rest (H2, H7, H9, H10)

There's **no migration**. There's no new required secret either: each item uses keys the site already knows about.

| # | What | Where | Needs |
|---|---|---|---|
| H7 | **Compare couriers** | Orders → **Book courier** | Courier keys (Lalamove, Grab; BayanGo when enabled) |
| H2 | **Fill from photo** | Products → Add/Edit → after uploading a photo | `GEMINI_API_KEY` or `OPENAI_API_KEY` (Groq can't read images) |
| H9 | **Background removal cap** | Products → Remove background | `REMOVE_BG_API_KEY` (already supported) |
| H10 | **Next 30 days forecast** | Reports (top card) | 90 days of orders |

## H7 — Compare couriers (palenkeAi "DeliveryRiderEstimator")

**Book courier** now opens a dialog with live quotes from every courier the shop can use:

- price, ETA and distance for each;
- tags for **Fastest** (the usual auto-pick) and **Cheapest**;
- a list of couriers that couldn't quote, and why.

The seller presses **Book** on the one they want. Only that courier is booked: if it refuses, the
seller sees the error and picks another, so there's no silent switch. The old no-body call to
`book-delivery` (best courier, with failover) still works, for example for the API.

- New route: `POST /api/orders/{id}/delivery-quotes` (permission `orders.fulfil`). It books nothing.
- `book-delivery` accepts `{ "provider": "lalamove" | "grab" | "bayango" | "manual" }`. The courier must
  be one the shop's delivery setting allows.
- Both routes share `apps/admin/lib/delivery-booking.ts` (order checks, address lookup, sender details).

## H2 — Fill from photo (palenkeAi "analyze-catalog-product")

After uploading a product photo, **Fill from photo** sends it to a vision model. The model returns a
Taglish **name** and **description** plus a "please fill in" list (for example Size, Material). These fill the form for
review, and nothing is saved until **Save**.

Rules, enforced in the prompt and again when the reply is cleaned:

- no price or stock;
- no brand, size, material or certification unless it's printed in the photo;
- no "genuine/authentic/original/guaranteed/100%";
- no emojis;
- the title is capped at 80 characters and the description at 600.

If the seller already typed a name, it is passed in as a hint. Each use takes **1 monthly AI generation**
(Free 5, Growth 100, Pro 500), the same pool as captions. The photo must be JPG, PNG or WebP, up to 6 MB.

- Code: `packages/ai/src/product-from-photo.ts` (+ test).
- `callVision` and `resolveVisionModel` in `providers/llm.ts`: Gemini first, then OpenAI `gpt-4o-mini` at low detail. Test mode uses a mock.
- Route: `POST /api/products/from-photo` (`products.edit`).
- `lib/ai-assist.ts` gained `runAiForTenant` (the plan-limit wrapper for any AI job).

Products have no tags field, so the model's tags aren't used yet.

## H9 — Product photo backgrounds (palenkeAi "AiLabs")

The **white-background** part already existed: **Remove background** uses remove.bg when `REMOVE_BG_API_KEY` is
set, and a local model in development. New: with remove.bg (paid per photo), **each removal uses 1 monthly AI generation**,
so a shop's cost is capped by its plan. The button no longer says "(free)".

**Not built:** AI "lifestyle" scenes (a product placed in a kitchen, on a table…). That needs an
image-generation model and a cost check first. It stays on the roadmap.

## H10 — Next 30 days (palenkeAi "RevenueForecastTab")

A card at the top of **Reports**:

- **Under 90 days of orders:** it says how many days are left. It shows no number.
- **After that:** "Next 30 days: ₱X – ₱Y", a range from the last 12 weeks' sales. Sales use the same
  definition as Reports: not cancelled or voided, minus refunds.
- **The range** is the weekly average × 30/7 ± 1.28 × the weekly spread × √(30/7). That's about an 80% band, rounded to ₱100.
- **Trend line:** a separate factual line, "Last 4 weeks are N% above/below the 8 before".

It's plain arithmetic; no AI is involved. A shop with uneven weeks gets a wide range, which is the honest answer.
Code: `forecastRange`, `trendPct` and `getRevenueForecast` in `queries/insights.ts` (+ tests); `GET /api/insights/forecast`
(`reports.view`); `components/ai/forecast-card.tsx`.

## Test-only switch

`GUMA_TEST_GEOCODE=true` gives a stable Metro Manila point when the address lookup (OpenStreetMap)
can't be reached, so the courier mocks can quote in a sandbox. **Never set it in production.**

## Verified

Local production build, test adapters on:

- **H7:** the comparison showed Lalamove ₱89 (~35 min, Fastest + Cheapest), GrabExpress ₱95 (~40 min) and Own rider ₱89. Booking Lalamove showed "Lalamove booked for TES-P33 (₱89)" with the tracking link.
- **H2:** uploading a photo and pressing **Fill from photo** filled the name and description and showed "Please fill in: Size, Material". The AI allowance in the sidebar went down by one.
- **H10:** a new shop showed "88 to go". With temporary backdated orders the card showed a range and the trend line; those orders were removed afterwards.

**Tests:** ai 16 (+4), db integration 185 (+2 forecast), db unit 105, services 73, admin 14, web 3, route audit 9.
