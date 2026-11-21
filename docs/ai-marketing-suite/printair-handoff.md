# kart → Printair handoff (contract for printair.guma.one)

`GET https://printair.guma.one/api/import-from-gumakart?token=<JWT>`

* HS256, secret `GUMA_ECOSYSTEM_JWT_SECRET` (same value on both apps, ≥ 32 chars).
* Lifetime 5 minutes. Printair must:
  * reject expired tokens;
  * check `aud = "printair"` and `iss = "gumakart"`;
  * store `jti` and refuse a second use.
* Reference verifier: `verifyEcosystemJwt` in `packages/services/src/ecosystem/jwt.ts`.

```jsonc
{
  "iss": "gumakart", "aud": "printair", "sub": "<tenant uuid>",
  "iat": 1790000000, "exp": 1790000300, "jti": "<uuid>",
  "merchant_id": "<tenant uuid>", "tenant_id": "<tenant uuid>",
  "shop": { "name": "Simply Sweet", "slug": "simply-sweet", "url": "https://kart.guma.one/simply-sweet" },
  "seller": { "email": "owner@…", "name": "Ana" },
  "brand_assets": { "logo_url": "https://…", "brand_color": "#E11D48", "accent_color": null, "qr_url": "https://kart.guma.one/simply-sweet" },
  "mockups": [{ "url": "https://media.guma.one/…png", "variant": "mockup:thank_you_card" }],
  "print_ready_pdf_url": "https://media.guma.one/…/print_ready.pdf",
  "shipping_address": { "line": "Pickup address from shop settings", "country": "PH" },
  "milestone": "orders_10", "upsell_id": "<uuid>"
}
```

Printair should create (or find) the merchant by `merchant_id`, attach the PDF and mockups to a draft order (thank-you cards, stickers, mailer boxes), pre-fill shipping, and land the seller on checkout.
