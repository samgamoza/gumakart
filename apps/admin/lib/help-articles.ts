/**
 * Phase 16 — in-app help centre (Taglish, like the buyer screens). Short, practical steps
 * with a link to the page that does the thing. Add articles here; the page searches them.
 */
export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  href?: string;
  linkLabel?: string;
  tags: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "first-order",
    title: "Unang order sa loob ng 10 minuto",
    summary: "Mula sign-up hanggang may order ka na galing sa FB post o chat.",
    steps: [
      "Mag-add ng product: pangalan, presyo, at isang malinaw na photo.",
      "Sa Settings → Payments, ilagay ang GCash o Maya number mo (o i-on ang COD).",
      "Gumawa ng checkout link at i-paste sa post, comment o chat.",
      "Pag may order, makikita mo sa Orders — i-confirm ang bayad, i-pack, i-ship.",
    ],
    href: "/checkout-links",
    linkLabel: "Gumawa ng checkout link",
    tags: ["start", "simula", "setup", "onboarding"],
  },
  {
    id: "checkout-links",
    title: "Checkout links: paano gumawa at i-share",
    summary: "Isang link, isang page — bibili agad ang buyer kahit nasa Messenger o TikTok.",
    steps: [
      "Checkout links → New link, piliin ang products (o hayaan ang buyer pumili).",
      "Lagyan ng coupon kung may promo; puwede ring may expiry.",
      "Gamitin ang Share button para may tag kung saan galing (Facebook, TikTok, Messenger) — makikita mo sa Reports kung saan ka pinakamaraming benta.",
    ],
    href: "/checkout-links",
    linkLabel: "Buksan ang Checkout links",
    tags: ["link", "share", "facebook", "tiktok", "messenger"],
  },
  {
    id: "confirm-payment",
    title: "GCash/Maya: paano i-confirm ang bayad",
    summary: "Nagpapadala ang buyer sa number mo at nag-a-upload ng screenshot.",
    steps: [
      "Sa Orders, ang may 'Check payment' ay may proof na naka-upload.",
      "Tingnan sa GCash/Maya app mo kung pumasok ang eksaktong amount at reference.",
      "Pindutin ang Confirm payment — automatic na may text/email sa buyer.",
      "Kung mali, Reject proof — sasabihan ang buyer na mag-upload ulit.",
    ],
    href: "/orders",
    linkLabel: "Buksan ang Orders",
    tags: ["gcash", "maya", "bayad", "payment", "proof", "confirm"],
  },
  {
    id: "delivery",
    title: "COD at delivery: pag-book ng rider",
    summary: "Delivery fee, pickup, at rider booking mula sa order.",
    steps: [
      "Itakda ang delivery fees at pickup sa Settings → Delivery & shipping.",
      "Sa order, pindutin ang Book rider (Lalamove/Grab kapag naka-on na) o i-mark na out for delivery kung sarili mong rider.",
      "Pag delivered at COD, automatic na 'paid' at tapos ang order.",
    ],
    href: "/settings/delivery-shipping",
    linkLabel: "Delivery settings",
    tags: ["cod", "delivery", "rider", "lalamove", "grab", "shipping"],
  },
  {
    id: "stock",
    title: "Stock, sizes at colors",
    summary: "Variants, bilang ng stock, low-stock alerts at CSV import.",
    steps: [
      "Sa product, magdagdag ng options (hal. Size × Color) — hanggang 3 options.",
      "Sa Stock, i-type ang bilang per variant o i-upload ang CSV (puwede ang export ng Shopee/Lazada).",
      "Ilagay din ang Cost para makita ang tubo sa Reports.",
      "Hindi bababa sa zero ang stock — hindi ka mag-o-oversell.",
    ],
    href: "/inventory",
    linkLabel: "Buksan ang Stock",
    tags: ["stock", "inventory", "variant", "size", "csv", "cost"],
  },
  {
    id: "pos",
    title: "POS: shift, cash count at Senior/PWD",
    summary: "Pagbebenta sa tindahan, kahit mawalan ng internet.",
    steps: [
      "Gumawa ng cashier PIN sa Settings → POS & staff.",
      "Buksan ang shift na may panimulang cash; sa dulo, bilangin ang cash at isara.",
      "Senior/PWD: ilagay ang ID — automatic ang tanggal VAT at 20% discount.",
      "Offline? Tuloy lang ang benta; mag-si-sync pag may internet na.",
    ],
    href: "/pos",
    linkLabel: "Buksan ang POS",
    tags: ["pos", "cashier", "shift", "senior", "pwd", "offline", "bir"],
  },
  {
    id: "staff",
    title: "Staff at roles",
    summary: "Huwag nang ibigay ang password mo — bigyan ng sariling login ang staff.",
    steps: [
      "Settings → Staff → Invite: Manager, Staff (pag-pack at orders) o Cashier (POS lang).",
      "Lahat ng mahalagang gawain (bayad, refund, presyo, stock) ay nasa Activity log.",
    ],
    href: "/settings/staff",
    linkLabel: "Mag-invite ng staff",
    tags: ["staff", "role", "manager", "cashier", "activity"],
  },
  {
    id: "sms",
    title: "SMS updates, pahintulot at campaigns",
    summary: "Ano ang automatic na text, at sino lang ang puwedeng i-text ng promo.",
    steps: [
      "Order updates (bayad, shipped, delivered) ay automatic — Auto SMS para sa settings.",
      "Promo texts (SMS campaigns) ay para lang sa buyers na nag-yes sa texts sa checkout.",
      "Bawat promo text ay may link para mag-stop; hindi nagte-text mula 9 PM hanggang 8 AM.",
    ],
    href: "/campaigns",
    linkLabel: "SMS campaigns",
    tags: ["sms", "text", "campaign", "promo", "consent", "opt-out"],
  },
  {
    id: "discounts",
    title: "Discounts, coupons at bundle deals",
    summary: "'Buy 2, 15% off', coupon codes, at automatic discount.",
    steps: [
      "Discounts → Quantity deals para sa 'bumili ng 2 o higit pa'.",
      "Coupons: may simula at tapos, limit ng gamit, at isang beses lang kada buyer kung gusto mo.",
      "Online checkout at checkout links ang may deals ngayon (hindi pa sa POS).",
    ],
    href: "/discounts",
    linkLabel: "Buksan ang Discounts",
    tags: ["discount", "coupon", "promo", "bundle", "deal", "voucher"],
  },
  {
    id: "reports",
    title: "Reports at tubo",
    summary: "Benta, tubo, top products at buyers — at CSV para sa bookkeeper mo.",
    steps: [
      "Reports → piliin ang petsa (Today, 7 days, this month…).",
      "Ang tubo ay galing sa Cost na nilagay mo sa Stock — tingnan ang 'cost coverage'.",
      "I-download ang CSV ng orders, products, customers o daily sales.",
    ],
    href: "/reports",
    linkLabel: "Buksan ang Reports",
    tags: ["report", "sales", "benta", "profit", "tubo", "csv", "accounting"],
  },
  {
    id: "channels",
    title: "Messenger, Instagram, Shopee at Lazada",
    summary: "Isang stock count para sa lahat ng channel.",
    steps: [
      "Channels → i-connect ang Facebook Page/Instagram para makita ang chats dito.",
      "Shopee/Lazada: i-link ang listings sa products mo; ang Guma stock ang susundin.",
      "Ang mga 'Coming soon' ay naka-build na — bubukas kapag approved na ang Guma Kart sa provider.",
    ],
    href: "/integrations",
    linkLabel: "Apps & integrations",
    tags: ["messenger", "instagram", "shopee", "lazada", "channel", "tiktok"],
  },
  {
    id: "plan",
    title: "Plan, bayad at renewal",
    summary: "30 araw bawat bayad, may paalala, at 7 araw na palugit.",
    steps: [
      "Settings → Plan: magbayad gamit ang GCash, Maya o card.",
      "May email at banner 7, 3 at 1 araw bago matapos ang plan.",
      "Pagkatapos, 7 araw pang naka-on ang lahat; saka lang lilipat sa Free — walang nabubura.",
      "Makikita ang mga resibo sa Settings → Plan → Payments.",
    ],
    href: "/settings/subscription",
    linkLabel: "Buksan ang Plan",
    tags: ["plan", "billing", "bayad", "renew", "receipt", "resibo", "upgrade"],
  },
  {
    id: "api",
    title: "API at webhooks (para sa may developer)",
    summary: "Ikonekta sa accounting, Google Sheets, Zapier o sarili mong app.",
    steps: [
      "Owner lang: API & webhooks → gumawa ng key na may tamang permissions lang.",
      "Webhooks: ilagay ang URL ng Zapier/Make — may Send test at delivery history.",
      "Ang buong reference ay nasa Docs tab.",
    ],
    href: "/developers",
    linkLabel: "API & webhooks",
    tags: ["api", "webhook", "zapier", "make", "sheets", "developer"],
  },
  {
    id: "problem",
    title: "May problema? Status page at support",
    summary: "Alamin kung sa amin ang problema, at paano kami kontakin.",
    steps: [
      "Tingnan ang kart.guma.one/status — nandoon kung may delay o maintenance.",
      "Kung wala doon, mag-file ng ticket sa Settings → Support (may sagot sa email).",
      "Ilagay ang order number at screenshot para mas mabilis.",
    ],
    href: "/settings/support",
    linkLabel: "Contact support",
    tags: ["support", "help", "problema", "status", "down", "ticket"],
  },
];

export function searchHelp(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_ARTICLES;
  const words = q.split(/\s+/);
  return HELP_ARTICLES.filter((a) => {
    const hay = `${a.title} ${a.summary} ${a.steps.join(" ")} ${a.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
