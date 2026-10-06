# Phase 23 — Verified reviews (trust and social proof)

**Migration:** `0040_reviews` (run it on Neon before pushing). The pending Phase 2 constraints file moved to
**`drizzle-pending/0041_phase2_constrain.sql`** (same content, journal idx 41 when it's applied).
There's no new secret.

**Rule:** every review comes from a real order at that shop, so "Verified buyer" is always true.
There are no seeded, imported or invented reviews, and nothing shows until the first one.

## Buyer: "Kumusta ang order mo?"

- **Where:** the buyer's order page (the link from their SMS) shows a card for each item once the order is
  **delivered** or **completed**. It doesn't show for cancelled orders, or after 120 days.
- **What the buyer leaves:** 1–5 stars, optional text (up to 1,000 characters) and up to **3 photos**. Photos are shrunk on the phone,
  then stored like payment proofs (Blob → R2 → disk), under that shop and order. A review can only use
  photos uploaded from its own order link.
- **Limits:** one review per order item, and the buyer's words can't be edited later.
- **How it's shown:** the buyer's first name and last initial ("Ana R."), never the phone. POS placeholders like "Walk-in"
  show as "Buyer".
- **Afterwards:** the buyer sees their review, the shop's reply, and a note if the shop hid it.
- APIs: `POST /api/reviews` and `POST /api/reviews/photo`. Both check the order link and are rate limited. Photos are served at
  `/uploads/reviews/…`.

## Seller: Reviews page (Customers group in the menu)

- **Totals:** shop rating, last 30 days, needs reply, and reports open with Guma.
- **Filters:** All, Needs reply, 3★ and below, Hidden, Reported.
- **Reply** (public, up to 600 characters, editable).
- **Hide** with a reason that only the seller sees. Hidden reviews leave the shop rating. **Show again** works unless
  Guma removed the review.
- **Report to Guma** (abuse, spam, personal info, not a real experience).
- **Permissions:** everyone who can see customers can read reviews. Reply, hide and report need `marketing.manage`
  (owner and manager). Each action is written to the activity log.

## Storefront

- **Product cards** (the shared card and the themed cards) show stars and the count when a product has reviews.
  The ~20 theme renderers that draw their own cards don't show stars yet; see the follow-up below.
- **Product page:** stars under the title (linking to `#reviews`), and a **Reviews** section with photos and the shop's replies.
- **Shop home:** a slim **trust bar** above any theme, for example "★ 4.8 from 23 verified buyer reviews", with buyer photo
  thumbnails. It links to **`/{shop}/reviews`**, the full list.

## Guma ops: Trust & safety → Review reports

The ops page lists reports in three tabs: Open, Kept and Removed. Each shows the shop, the product, the review, its photos and the seller's
reason.

- **Keep review** closes the report and changes nothing.
- **Remove for good** hides the review; the seller can't show it again.

Both actions are written to the audit log. The ops team never edits the buyer's words.

## SMS ask (opt-in)

There's a new automation, **"Ask for a review"**, and it is **off until the seller turns it on** (Automations page). It's the
first opt-in recipe; every other recipe stays on by default. When it's on, the timed automations cron runs every 5 minutes
outside quiet hours and sends one text per order:

- 2–14 days after the order was delivered or completed;
- only to buyers who said yes to texts;
- only when nobody has reviewed the order yet.

The text: *"Tess Lifestyle PH: Kumusta ang order #TES-0025? I-rate ang items mo dito, salamat! {order link}"* plus the
opt-out link. It needs Semaphore to actually send.

## Code

| Area | Files |
|---|---|
| DB | `drizzle/0040_reviews.sql`; `schema/index.ts` (`productReviews`); `queries/reviews.ts`; `queries/storefront.ts` (`rating` on products and the shop); test `reviews.test.ts` (8) |
| Buyer site | `components/order-review-card.tsx`, `rating-stars.tsx`, `product-reviews.tsx`, `shop-trust-bar.tsx`; `app/[tenantSlug]/reviews`; `app/api/reviews` (+`/photo`); `app/uploads/reviews`; `lib/review-uploads.ts` |
| Admin | `app/reviews`, `components/reviews-manager.tsx`, `app/api/reviews` (+`[reviewId]`); nav + `staff-permissions.ts`; `lib/automations.ts` (review request); settings schema |
| Ops | `app/moderation/reviews`, `components/review-report-actions.tsx`, `resolveReviewReportAction`; the nav highlights the most specific item |
| Services | `reviewRequestSms`, `OPT_IN_RECIPES`, `isRecipeEnabled` (opt-in aware), test |

## Not in this phase

- **Q&A on the product page** (the optional slice).
- Stars inside the ~20 custom theme renderers (they draw their own cards). The trust bar and product pages cover every theme.
- Letting the buyer edit their own review.

## Verified

Local production build:

- **Buyer:** the buyer rated "Ceramic Coffee Mug" on TES-0025 with 5 stars, text and a photo. The card then showed "Salamat sa review mo!".
- **Seller:** the review showed with Verified buyer, the photo and the totals. The seller posted a reply.
- **Shop home:** the trust bar read "★ 5.0 from 1 verified buyer review".
- **Product page:** showed 5.0 (1) and the Reviews section with the seller's reply.
- **Ops page:** not opened in the browser, because ops sign-in needs an authenticator in the sandbox. Report, keep and remove are covered by the integration test and the platform build.

**Tests:** db integration 193 (+8), services 74 (+1), db unit 105, admin 14, web 3, ai 16, auth 18, route audit 9.
**Builds:** admin, web and platform all pass.
