# Phase 3 — Comment-to-DM & 24/7 Taglish AI Sales Closer

Migration: `packages/db/drizzle/0049_social_closer.sql` (additive only).

## Flow
```
Meta (FB feed / Messenger / IG) ─► /api/webhooks/meta      ┐  signature check → 200 fast
WhatsApp Cloud API             ─► /api/webhooks/whatsapp  ┘  then after():
   comment  → handleCommentEvent   (lib/social-automation.ts)
   DM       → runCloserForThread   (3 s debounce, per-chat lock)
   button   → handleCloserPostback ("Switch to COD")
cron every 2 min ─► /api/cron/social-ai → runCartRecovery + sweepUnansweredChats
```

## Comment-to-DM (Starter and up)
1. `claimCommentAction` (unique per account + comment, so Meta retries do nothing).
2. Skip: own comments, Free plan, no rule, no keyword, same commenter already DMed for this post in the last 24 h.
3. Rule: the post's rule (from the Phase 2 copywriter "attach trigger") wins over the shop's global rule (no post). Pending rules (no post link yet) never match.
4. One **Private Reply**:
   * the product card with "Order now" (a ready checkout link if the product has one option, else the product page);
   * a friendly opener if the rule has no product.
5. Random public reply (`{name}` is filled in). The chat appears in the inbox.

The buyer has not messaged yet, so the AI does not follow up until they reply (Meta rules).

### pfbid links
When a seller pastes a post link to activate a trigger (`PATCH /api/ai/copywriter/posts/[id]`):
* Numeric ids / `story_fbid=123` / `/posts/123`: used as-is.
* `pfbid…`, reels, links without an id: looked up on each connected Page (`/{page}/published_posts`, `/{page}/videos`, paged). Saved as `<pageId>_<postId>`.
* Instagram `/p/<shortcode>`: looked up on the connected IG account (`/{ig-user}/media`). If it isn't found yet, the shortcode is kept and the seller sees a notice.

## The AI closer (Pro Live, Enterprise Vibe)
Turn loop: `runCloserTurn` in `packages/ai/src/agents/taglish-closer.ts`, max 5 steps.

| Tool | Grounded in | Notes |
|---|---|---|
| `check_product_inventory` | `products` / `product_variants` | `stock_left` only when the shop tracks stock (D5) |
| `quote_bayango_delivery` | `quoteChatDelivery` | BayanGo → Lalamove → shop flat rate; free only from the shop's minimum |
| `create_prefilled_checkout_link` | `createPrefilledChatCheckoutLink` | GCash / Maya / QRPh / COD if the shop takes it; ≤ AI_CHAT_LINKS_PER_DAY per chat; 7-day expiry |
| `escalate_to_human_seller` | `pauseThreadAi` | Seller gets a push alert. Inbox: "Let AI continue" |

**When it stays quiet:**
* the shop or account switched it off (Channels → "AI closer: on/off");
* the chat is paused;
* a human replied in the last 15 minutes;
* the daily cap is reached (the seller is alerted once);
* the 24-hour window is closed.

**Guards:**
* An unknown ₱ amount gets one recheck, then it is removed.
* Invented stock, "sold" or free-shipping claims are scrubbed.

**Serving:**
* The GPU node (native tools) serves first.
* On 530 / 503 / timeout, the turn continues on the cloud model.
* With no cloud keys, a polite holding reply is sent.

## Recovery worker
* **Due:** the link went out ≥ 30 min ago, and the chat's last buyer message is < 23 h 30 min old.
* **Not due:** the chat is paused, already nudged for this link, or the order is paid or COD.
* **AI-personalised** on closer plans, template otherwise. Never says "reserved".
* **Buttons:**
  * Finish my order / Complete Payment (the buyer's own order page when an unpaid order exists).
  * Switch to COD (ghost buyers only, when the shop takes COD).

## Setup (Meta app)
* **Messenger / Instagram:** webhook `https://admin.guma.one/api/webhooks/meta`. Page fields: `messages`, `messaging_postbacks`, `feed`. Instagram fields: `messages`, `comments`.
  * Permissions: `pages_messaging`, `pages_read_engagement`, `pages_manage_engagement` (comment replies), `pages_read_user_content`, `instagram_manage_comments`, `instagram_manage_messages`.
  * Already-connected Pages must reconnect once to add `feed`.
* **WhatsApp:** webhook `https://admin.guma.one/api/webhooks/whatsapp`, field `messages`. Then the seller connects a number in Channels using:
  * the Phone number ID;
  * a permanent System User token with `whatsapp_business_messaging`.
* **vLLM:** `--enable-auto-tool-choice --tool-call-parser hermes` (see gpu-node-setup.md).

## Env (admin Worker)
| Var | |
|---|---|
| `WHATSAPP_APP_SECRET` | optional, falls back to `META_APP_SECRET` |
| `WHATSAPP_VERIFY_TOKEN` | optional, falls back to `META_VERIFY_TOKEN` |
| `GPU_BRIDGE_URL`, `GPU_BRIDGE_SECRET` | already set in Phase 2 |
| `BAYANGO_API_BASE_URL`, `BAYANGO_API_KEY` | existing; enables live BayanGo quotes and the "via BayanGo" wording |

## Tests
| Suite | Covers |
|---|---|
| `packages/ai` | keyword matcher, closer loop (tools, fallback mid-turn, price guard, D5 scrub, escalation, step limit), nudge |
| `packages/services` | comment parsing, private replies, pfbid / shortcode lookup, WhatsApp parse / payloads, delivery quote fallback |
| `packages/db` (`social-automation.test.ts`) | rules, idempotency, inventory, prefilled links, recovery selection incl. 24 h window, sweep |
| `apps/admin` (`test:integration`) | comment → DM → closer with tool calls → nudge → Switch to COD → escalation |
| `workers/gpu-bridge` (`test:e2e`) | tool calls through the real signed bridge |
