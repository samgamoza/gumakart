# Phase 32 — palenkeAi harvest: buyer referrals (H8) + Suki win-back (H5)

**Migration:** `0039_referrals` (run it on Neon before pushing). The pending Phase 2 constraints file
moved from `drizzle-pending/0039_phase2_constrain.sql` to **`0040_phase2_constrain.sql`** (same content).
There's no new secret.

## H8 — "Give ₱50, get ₱50" buyer referrals

Off by default. Turn it on in **Settings → Suki loyalty → Referrals**. The share link only shows
when **Suki points are also on**, because it sits inside the buyer's Suki card.

1. A buyer opens their order page. The Suki card shows **"Mag-invite ng kaibigan"** with their code
   (one per buyer per shop: `S` plus 6 characters, with no 0/O/1/I/L). **Copy link** or the phone's share sheet
   sends `/{shop}?ref=suki&code=SXXXXXX`.
2. The friend's browser remembers the code for that shop for 30 days. A later `?ref=sms` or
   `?ref=tiktok` visit doesn't replace it. Channel reports show these visits as **suki**.
3. The code goes to the server with the friend's order. It sticks only if referrals are on, the code is real, and it
   belongs to *another* buyer of the same shop.
4. Every 5 minutes (the loyalty cron, up to 500 at a time), each referred order is checked once it's **paid**
   (COD counts once delivered), and only if it isn't cancelled or voided. If it passes, **both** buyers get a store-credit
   card ("Suki referrals"). It's paid once per friend, safe against two checks running at once.

**Not rewarded (recorded with the reason, never re-checked):**

| Reason shown | Rule |
|---|---|
| Same buyer | Same customer, or the same last 10 phone digits |
| Not their first order | The friend had ordered from the shop before |
| First order under ₱X | Items after discount below the minimum (default ₱300) |
| Referrer has no paid order yet | The inviter must be a paying customer |
| Referrer reached this month's limit | Default 10 rewarded friends per inviter per month (Manila time) |
| Code no longer valid | The code doesn't match a buyer any more |

Defaults: ₱50 / ₱50, first order at least ₱300, 10 per month. Each reward can be ₱0–₱5,000.

**On purpose:** rewards are store credit only, never cash. Once issued, a reward **stands even if the
order is later cancelled or refunded**. The seller can void the card in Gift cards if needed. The settings
card shows last-30-days rewarded, credit issued, not eligible, and top inviters.

## H5 — Suki win-back campaign

In **SMS campaigns**, the new **"Suki win-back"** audience lets the seller pick a tier and a number of days:

- Tier: Silver and up, Gold and up, or Platinum.
- Days: no order in the last N days (default 45, minimum 14).

Tier comes from the last 12 months' spend, using the shop's own Suki thresholds. Only buyers who said
yes to texts are included. It works whether or not points are turned on.

Picking it fills an ASCII preset, unless the seller already wrote a message: *"Hi {name}! Miss ka na
namin. May bagong stocks kami, silipin mo dito:"*. The shop name, link and opt-out are added as usual. It needs
Semaphore to actually send, like every campaign. The optional store-credit bonus idea is left for later.

## Code

| Item | Files |
|---|---|
| DB | `drizzle/0039_referrals.sql` (`customers.referral_code`, `orders.referral_code`, `referrals`); `schema/index.ts`; `types/loyalty.ts` (`referralRules`, `newReferralCode`, `normalizeReferralCode`); `queries/referrals.ts`; `queries/loyalty.ts` (keeps referral settings, order view carries the code); `queries/campaigns.ts` (segment `suki`) |
| Admin | `api/loyalty/referrals` (`marketing.manage`); `api/cron/loyalty` (also syncs referrals); `components/loyalty/referral-settings.tsx`; `components/campaigns-view.tsx`; `lib/campaign-api.ts` |
| Buyer site | `lib/referral-capture.ts`, `components/referral-capture.tsx` (in the shop layout); `components/suki-share.tsx`, `suki-order-card.tsx`; `checkout-form.tsx`, `link-checkout.tsx`, `lib/place-order.ts` |
| Tests | `packages/db/src/referrals.test.ts` (9: rules, codes, the double-sweep race, every block reason, the cap, the summary, the win-back segment) |

## Verified

In the browser on a local production build:

- Referral settings saved.
- The **Suki win-back** audience showed its tier and day controls, the reach count and the ASCII preview.
- The buyer order page showed the invite block with the code.
- Opening `?ref=suki&code=…` stored the code. A later `?ref=sms` visit kept it.
