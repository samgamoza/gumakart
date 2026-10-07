# Phase 34 — The Palenke look

**No migration and no new secret.** This phase is a visual refresh of the seller dashboard and the buyer checkout, plus a new shop theme. palenkeAi was used as the mood board. The rule stays the same: honest copy only, with no invented numbers.

| Slice | Commit | What |
|---|---|---|
| 34a | `a739dc9` | Seller dashboard: light theme by default, dark mode as a choice |
| 34b | `eb1015d` | Buyer checkout: the shop's own colour, white fields, soft cards |
| 34c | `98681ce` | New **Palenke** shop theme, with a Suki referral strip |

## 34a — Seller dashboard (admin)

**The light theme**

- The dashboard is now light by default: slate-50 canvas, white cards, violet primary (`#7c3aed`), Inter for text, Space Grotesk for headings.
- The old dark look is still there. The **Sun/Moon button** next to Sign out switches it. The choice is saved per device (localStorage `guma-admin-theme`) and applied before the page paints, so there's no flash.
- Tailwind dark mode now follows `[data-theme="dark"]` instead of the system setting.

**How existing screens were converted**

- **Remap layer.** Older screens were written for a dark background. A light-only remap in `globals.css` converts their dark-only utility classes: text-slate-100…600, text-white, white/[0.03] fills, white/10 borders, and 100–400 accent text, which becomes the 700 shade.
- **What the remap skips:**
  - Any element that has a `dark:` class. Those are written for both themes already.
  - White text on coloured or gradient backgrounds.
- **New markup** should use paired classes (`bg-white dark:bg-…`). The remap leaves those alone.

**Shell and Overview**

- **Shell:** white sidebar and top bar. The active nav item is solid violet. The AI credits card has a violet gradient.
- **Overview:**
  - "Seller dashboard" chip and a greeting.
  - To-do cards with icon tiles and a "Needs you" chip. Urgent cards get a violet or amber ring.
  - A deep-violet **Today** hero with glass tiles.
- **Helpers:** `.pk-label`, `.pk-number` and `.pk-chip` are in `globals.css`.
- **Logos** on the auth and partner pages switch with the theme.

## 34b — Buyer checkout (web)

- **Colour:** the fixed Shopee-orange (`#ee4d2d`) is gone. Checkout uses the shop's own colour (`--shop-accent`) and picks a readable text colour for it (`--shop-accent-ink`).
  - The colour comes from `solidCtaColor`. A colour too light for white text falls back to violet.
- **Fields:** white, with a focus ring in the shop colour. This also covers the address fields and the gift card input.
- **Cards:** rounded-2xl with a soft shadow. The shared `Card` in `@gumakart/ui` uses the same shadow now.

## 34c — The Palenke shop theme (web)

**Picking it**

- It's in the seller's template list (Settings → Shop → Change) as **Palenke**, basic tier, free on every plan.
- It has **no category hints**, so no shop is ever switched to it automatically.
- Choosing it sets `patternId: "palenke"` through the normal `PATCH /api/shop` path.
- Ops → Frontends lists it like any other template.

**What buyers see**

- **Header:** logo, shop name in capitals, an "Ordering online" dot, and the basket with its count.
- **Banner:** a gradient in the shop's own colour.
  - Category chip, then a title and subtitle.
  - The title is the shop's promo line if the seller set one, otherwise the shop name. The subtitle is the promo subtitle, otherwise the tagline. The built-in default promo text ("Free delivery on orders ₱500+") is **never** shown, because the shop may not offer it.
  - Shop stars appear only when there are verified reviews.
- **Pay with tile:** lists only methods the shop actually has: GCash/Maya if numbers are set (or PayMongo is on), card with PayMongo, bank transfer if an account is set, and cash on delivery if COD is on. It also shows the location.
- **Category chips:** appear only when the shop's products span two or more categories. They filter on the page, with no reload.
- **Product cards:**
  - Photo with a price pill (and the struck-out old price on sale items) and a save heart.
  - Category chip, title in bold capitals, verified stars, and a description (hidden when it just repeats the title).
  - **Details** and a solid **Add to basket** button.
  - Products with sizes or colours open the size picker (the existing `?pick=1` flow).
  - Sold-out items show **Notify me**, which opens the product page and its back-in-stock form.
  - Pre-order items show "Pre-order · ships ~Oct 31" and a **Pre-order** button.
- **Footer:** dark, with the shop name, tagline, location and "Powered by Guma Kart". The shop assistant bubble works as on other themes.

**Suki referral strip**

- It's an orange strip under the banner. Example: *"Invite a friend: ₱50 for them, ₱50 for you"*, with the minimum order from the shop's settings.
- **When it shows:** only when the shop has **both** Suki loyalty and referrals on. The buyer's share link lives on the order page's Suki card, which needs loyalty on. With either off, the strip doesn't render at all.
- **Where the data comes from:** `DemoTenant.referral`, set in `get-storefront-tenant.ts` from `referralRules` + `loyaltyRules`.
- It has no sign-up button. The copy tells the buyer that their link appears on their order page.

**Left out of palenkeAi's storefront, on purpose**

- Fake stock counts ("Stock: 10 left").
- A fixed "25–35 minutes" delivery time.
- The reseller/MLM banner.

## Code

| Area | Files |
|---|---|
| Admin (34a) | `app/globals.css`, `app/layout.tsx`, `tailwind.config.ts`, `components/theme-toggle.tsx` (new), `admin-shell.tsx`, `dashboard-view.tsx`, `auth-layout.tsx`, `partner/partner-dashboard.tsx` |
| Web checkout (34b) | `components/checkout-form.tsx`, `ph-address-fields.tsx`, `gift-card-input.tsx`, `app/[tenantSlug]/checkout/page.tsx`; `packages/ui` Card shadow |
| Theme (34c) | `components/storefront/palenke/palenke-storefront.tsx` (new); `theme-renderer.tsx`, `tenant-storefront-home.tsx`; `lib/demo-data.ts` (`referral`), `lib/get-storefront-tenant.ts`; storefront-themes `types`, `patterns`, `templates`, `template-packages`, `template-previews`, `template-registry`; db `patternId` unions |

## Verified

Local production build, test shop `tess5244`:

- **34a:** light and dark checked on Overview, Orders, Stock, Reports, POS, Checkout links, SMS campaigns, Delivery settings, Login and phone width. Dark mode stays after a reload.
- **34b:** checkout on a phone uses Tess's pink, with white fields.
- **34c:**
  - **Picker:** Palenke appears in `/api/shop/templates` (unlocked), and `PATCH templateId: "palenke"` saves `patternId: "palenke"`.
  - **Desktop and phone:** the storefront rendered with 4 cards. Add to basket on the backpack (which has options) opened the size picker.
  - **Chips:** two temporary categories → chips All / Bags / Home / Food & Beverage, and **Home** filtered to the lamp and the mug.
  - **Referral strip:** shown with Tess's ₱50 / ₱50 / ₱300 settings. With referrals off, it was gone from the page.
  - **Cleanup:** the test categories were removed. Tess's theme (Sarab) and her loyalty settings were put back exactly.

**Tests:** route audit 9, admin 17, web 3, storefront-themes 50, ai template-skins 2. Admin and web build, and typechecks are clean.
