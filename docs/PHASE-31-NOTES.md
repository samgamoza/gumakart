# Phase 31 — palenkeAi harvest: quick wins (H1, H3, H4, H6)

There's **no migration** and no new secret. H1 uses the AI key if there is one; without a key it
returns a plain template message with the same quantities.

| # | What | Where | Notes |
|---|---|---|---|
| H1 | **Draft supplier message** | Overview → "Paubos na" card | Taglish reorder note with the card's exact quantities, plus an optional supplier name. **Copy** or **Send via Messenger/Viber** (the phone's share sheet). If the AI leaves out an item or quantity, the exact list is added. Uses the daily AI allowance. Needs stock-adjust permission (owner, manager). |
| H3 | **New-order chime + alert** | Every admin page (bell button, bottom right) | Checks every 30 s for new online orders (POS sales don't count). Plays a two-tone chime and shows a toast with **View**. If the tab is in the background and the seller allowed notifications, a desktop notification appears too. The bell mutes it, remembered on this device. Browsers only play sound after the seller has tapped the page once; tapping the bell also asks for notification permission. |
| H4 | **POS scanner beep, full screen, paper width** | Register header | High beep when a scan adds an item, low buzz when the code isn't found. A full-screen register button. **58 mm / 80 mm** receipt width, saved per device (prints at 48 mm or 72 mm). |
| H6 | **GoTyme / bank name on the buyer's option** | Checkout link payment options | Shows "Bank transfer · GoTyme" when the shop has filled in its bank name and turned bank transfer on. The bank field in Settings → Payments now hints at GoTyme, BPI, BDO and UnionBank. Bank transfer itself already existed. |

## Code

| Item | Files |
|---|---|
| H1 | `packages/ai/src/seller-assist.ts` (task `supplier`, with a test); `apps/admin/app/api/insights/supplier-note` (`stock.adjust`); `components/ai/restock-card.tsx` |
| H3 | `apps/admin/app/api/orders/latest` (`orders.view`); `components/new-order-alerts.tsx`, mounted in `admin-shell.tsx` |
| H4 | `apps/admin/lib/pos-beep.ts`; `components/pos/pos-register.tsx` |
| H6 | `apps/web/app/c/[code]/page.tsx`; `components/settings/payments-settings.tsx` |

## Verified

In the browser on a local production build:

- **H1:** the supplier message showed "Kuya Ben" and the exact line ("Canvas Backpack — Sand / 30L — 1 pcs").
- **H3:** an order inserted while the dashboard was open showed the "New order!" toast within one poll.
- **H4:** the POS header showed the 58mm selector, saved on the device, and the full-screen button.
- **H6:** the link page showed "Bank transfer · GoTyme". The test shop's bank setting was put back afterwards.

**Tests:**

| Suite | Result |
|---|---|
| ai | 12 |
| db unit | 105 |
| admin | 14 |
| route audit | 9 |

## Still on the harvest list

- **H2** photo → listing (needs a vision AI key)
- **H5** Suki win-back campaign (needs Semaphore)
- **H7** courier comparison (needs courier keys)
- **H8** buyer referral codes
- **H9** AI photo backgrounds
- **H10** forecast (needs history)
