# Phase 20 — Storefront speed

There's **no migration**.

**One Cloudflare change:** the web Worker now has an Images binding (`"images": { "binding": "IMAGES" }` in
`apps/web/wrangler.jsonc`). Sam approved the cost on 2026-10-06:

- 5,000 unique image transformations a month are free.
- Beyond that, a paid Workers plan is charged $0.50 per 1,000.
- If the first deploy complains about the binding, turn on **Images** in the Cloudflare dashboard.

## Results

Measured with Lighthouse 12, mobile profile (simulated slow 4G and mid-range CPU), on a local production
build of the "Tess Lifestyle PH" test shop (Sarab theme). Each figure is the median of 3 runs.

| Page | Score | First paint | Main content (LCP) | Download |
|---|---|---|---|---|
| Checkout link `/c/…` | 83 → **99** | 1.1 → 1.2 s | 4.5 → **1.8 s** | 689 → **204 KB** |
| Storefront `/shop` | 84 → **96** | 2.0 → **1.2 s** | 3.6 → **2.6 s** | 806 → **254 KB** |
| Checkout `/shop/checkout` | 95 → 97 | 1.1 → 1.2 s | 2.4 → 2.1 s | 288 → 228 KB |
| Product page | 98 → 96 | 1.2 → 1.4 s | 2.0–2.3 → 2.3 s* | 238 → 244 KB |

\*The product page was already fast. Five extra runs gave 1.5–2.9 s (median 2.3 s), the same as before
within measurement noise.

**Why production should gain more than these local numbers show:**

- This sandbox can't reach Google Fonts, so before this phase those requests failed instantly here. Real
  phones waited for them.
- Production also served every Next image full-size, because there was no `IMAGES` binding.

## What changed

1. **Images were the main cost.**
   - A 491 KB photo was served at full size for a 56 px thumbnail and for the shop logo.
   - OpenNext on Cloudflare returns originals from `/_next/image` unless an `IMAGES` binding exists, and
     there wasn't one. So in production every Next image was full-size.
   - Seller uploads in R2 skipped resizing entirely.
2. **Changes:**
   - Added the `IMAGES` binding.
   - Seller photos: `/uploads/products/…?w=<width>` now returns a resized WebP through the binding, cached
     at the edge. Without the binding (local dev) it returns the original.
   - `lib/image-sizes.ts`: `sizedImageUrl` and `sizedSrcSet` with only 7 widths, plus WebP only
     (`next.config.ts`). Each photo × width counts as one transformation, so fewer widths keep usage inside
     the free tier longer.
   - Right-sized and lazy images on:
     - the checkout link (thumbnail and logo)
     - shop logos
     - the shared product image (srcset, lazy unless it's the first image)
     - the Sarab hero (the LCP image on Sarab shops, now high priority)
     - Sweet-kitchen's hero, grid and footer
     - Motto, Experience and themed-home logos
3. **Photos are shrunk in the browser before upload** (`@gumakart/ui/shrink-image`). The longest side
   is capped at 1600 px and the photo saved as WebP (JPEG where the browser can't make WebP), with EXIF
   rotation applied.
   - Applies to the product photo upload and onboarding in admin. Phone photos over 5 MB used to be
     refused; they're now shrunk and accepted.
   - Applies to the buyer's GCash/Maya screenshot at 2000 px, so receipts stay readable.
4. **Fonts:**
   - All 19 storefront themes loaded Google Fonts with `@import url(fonts.googleapis.com…)` inside their
     CSS. That chained two extra third-party connections in front of the first paint.
   - They're now self-hosted by `next/font` (`components/storefront/theme-fonts.ts`, 24 families).
   - Each family is a CSS variable with no preload, so a font file only downloads when the shop's theme
     uses it.
   - Theme CSS uses `var(--gf-x, "Family")`. If the variable were ever missing, the original family name
     still applies.
5. **Only the shop's own theme is downloaded.**
   - The theme switch was a server component calling `next/dynamic`. That doesn't code-split client
     components, so every storefront downloaded all 19 themes' code (292 KB, about 61 KB compressed).
   - The switch is now a client component (`theme-renderer.tsx`). Storefront first-load JS went from
     222 kB to **155 kB**.
   - Each theme's CSS is its own file, for example 9.5 KB for Sarab.
6. **Fixed two hydration mismatches**, which made React discard the server HTML and re-render the whole
   page on the phone:
   - The deals countdown counted to midnight in the server's timezone (UTC) on the server and in Manila
     time on the phone. It now shows `--:--:--` until it starts counting in the browser.
   - The "live selling" card showed a random "N watching" number.

## Needs your decision

- **The "LIVE" badge.** I removed the made-up viewer count: showing buyers an invented number is
  misleading, and could be a consumer-protection problem. The "LIVE" badge and the "{shop} Live" card
  are still there, in the Growth-plan *live selling* section of the classic theme. Is there a real live
  stream behind it? If not, it should become something like "Watch our live sales on Facebook/TikTok"
  linking to the shop's live page.

## Verified

- **All 22 storefront themes/renderers render with no errors** on the production build. Each was
  switched in turn on the test shop, which was then restored.
- Broken images exist only for Unsplash demo photos, which this sandbox can't reach; that's the same as
  before.
- The server HTML includes only the active theme's CSS, as a render-blocking stylesheet, so there's no
  flash of unstyled content.
- **Tests:**

  | Suite | Result |
  |---|---|
  | db unit / integration | 105 / 161 |
  | auth unit / integration | 9 / 4 |
  | admin | 14 |
  | web (new `image-sizes.test.ts`) | 3 |
  | services | 73 |
  | route audit | 8 |

- Typecheck is clean in 6 packages. Admin, platform and web production builds pass.

## Not done / follow-ups

- **Some theme hero and gallery images in other themes** still use plain `<img>` with the original. The
  biggest ones (logos, the Sarab hero, product images, Sweet-kitchen) are done; the rest can be swept
  the same way with `sizedImageUrl`.
- **About 46 KB of shared CSS:** mostly Tailwind (21 KB compressed), plus about 1 KB of font declarations.
  It could be trimmed, but that isn't urgent.
- **Real-device measurement:** once deployed, run PageSpeed Insights on a live shop and a checkout link
  to confirm the production gains (fonts and image resizing can't be measured here).
- **If the free image allowance runs out** on a Free plan:
  - Seller photos fall back to the original automatically. The route catches the error and serves the
    full-size file.
  - `/_next/image` behaviour on overflow is OpenNext's; check the Workers logs if images ever go missing.
