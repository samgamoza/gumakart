# Phase 26 — AI seller assistant (palenkeAi ideas, built honestly)

There's **no migration** and no new secret. It uses the AI keys Guma Kart already supports
(`GEMINI_API_KEY`, `OPENAI_API_KEY` or `GROQ_API_KEY`).

- **Production without a key:** the AI buttons answer "AI isn't set up for this site yet."
- **Dev and tests:** a fixed template answer, built from the same real numbers.

## What sellers get

| Feature | Where | Who can use it | What it does |
|---|---|---|---|
| **Ask Guma** | Floating button on the Overview | Owner, manager (needs reports) | A business advisor that answers only from the shop's own last-30-day numbers. Shown under each answer: "Based on 30 days: ₱…, N orders". |
| **Paubos na — restock soon** | Overview card | Anyone who can see products | Variants that will run out within 14 days at the last 30 days' pace, with an order amount covering 2 more weeks. Plain arithmetic, no AI. Hidden when nothing is running out. |
| **Captions** | Products (active items) and a checkout link's share panel | Owner, manager (marketing) | Facebook, Instagram and TikTok captions in Taglish, with the product or checkout link guaranteed inside each one. Editable, with a Copy button. |
| **Suggest replies** | Chats (inbox) | Anyone who can reply to chats | Three replies to the buyer's latest message. They use only the shop's product names, prices and stock, and tapping one fills the reply box. **Nothing is sent automatically.** |

## Guardrails (what palenkeAi didn't have)

- **Every AI route is signed-in and role-checked** (staff permission rules). palenkeAi's `/api/ai/*` were open to the internet.
- **Limits:**
  - Captions use one "AI generation" from the plan's monthly pool (Free 5, Pro 100, Advance 500).
  - Replies and Ask Guma have a daily allowance per plan: Free 15, Pro 150, Advance 400.
  - All tokens count toward the monthly soft budget, which switches to the cheaper model when used up.
- **Prompts forbid invented facts:** no prices, stock, discounts, delivery times, reviews or sales numbers that aren't given.
- **Outputs are validated** (zod) and cleaned:
  - HTML is stripped.
  - Captions always contain the link exactly once.
  - Hashtags are cleaned, and malformed AI output is rejected rather than shown.

## Code

| Piece | Where |
|---|---|
| Prompts, parsing, fallback, `runSellerAssist` | `packages/ai/src/seller-assist.ts` (+ `seller-assist.test.ts`, 6 tests) |
| Restock math, advisor facts, reply facts | `packages/db/src/queries/insights.ts` (+ `insights.test.ts`, 4 integration tests) |
| Quota and limits wrapper | `apps/admin/lib/ai-assist.ts` |
| Routes | `/api/insights/advisor` (`reports.view`), `/api/insights/restock` (`products.view`), `/api/ai/captions` (`marketing.manage`), `/api/inbox/[threadId]/suggest-replies` (`messages.reply`) |
| UI | `components/ai/ask-guma.tsx`, `restock-card.tsx`, `captions-dialog.tsx`; Suggest replies in `social-inbox.tsx` |

## Verified

- In the browser on a local production build: Ask Guma answered from Tess's real 30-day numbers
  (₱34,215, 25 orders, best seller Canvas Backpack). Captions for TikTok included the product link.
  Suggest replies filled three options under a simulated Messenger message.
- **Tests:**

  | Suite | Result |
  |---|---|
  | ai | 11 |
  | db unit | 105 |
  | db insights (integration) | 4 |
  | route audit | 9 |

## Not in this phase

- **Listing from a photo** (palenkeAi's "analyze product image"). It needs a vision-capable call and image
  upload to the model. It's a good next step once an AI key is live; see the harvest list in
  `docs/ROADMAP-POLISH.md`.
- **Revenue forecasting** (palenkeAi's 30-day projection). The restock card covers the useful part honestly.
  A sales forecast would need more history than new shops have.
