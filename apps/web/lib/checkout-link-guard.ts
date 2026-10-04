import type { PublicCheckoutLink } from "@gumakart/db";

/** Buyer-facing reason a link can't take orders, or null when it can. */
export function closedLinkMessage(link: PublicCheckoutLink): string | null {
  if (link.tenantStatus === "suspended") {
    return "Pansamantalang hindi available ang shop na ito. Paki-message ang seller.";
  }
  if (link.tenantStatus !== "active") return "Hindi pa tumatanggap ng order ang shop na ito. Paki-message ang seller.";
  switch (link.status) {
    case "off":
      return "Isinara na ng seller ang link na ito. I-message sila para sa bago.";
    case "expired":
      return "Tapos na ang link na ito. I-message ang seller para sa bago.";
    case "sold_out":
      return "Naabot na ng link na ito ang limit ng orders. I-message ang seller para sa bago.";
    default:
      break;
  }
  if (link.items.length === 0 || link.items.some((i) => !i.productActive)) {
    return "Hindi na available ang isang item sa link na ito. I-message ang seller para sa bago.";
  }
  return null;
}
