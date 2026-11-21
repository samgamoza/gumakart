import { sendMetaMessage, type MetaOutgoing, type MetaSendResult } from "./meta";
import { sendWhatsAppMessage } from "./whatsapp";

/** One send for every chat channel: Messenger / Instagram through the Page, WhatsApp through the number. */
export async function sendSocialMessage(input: {
  platform: "messenger" | "instagram" | "whatsapp";
  account: { externalId: string; pageId: string | null; phoneNumberId?: string | null };
  token: string | null;
  recipientId: string;
  message: MetaOutgoing;
}): Promise<MetaSendResult> {
  if (input.platform === "whatsapp") {
    return sendWhatsAppMessage({ phoneNumberId: input.account.phoneNumberId ?? input.account.externalId, token: input.token, to: input.recipientId, message: input.message });
  }
  return sendMetaMessage({ pageId: input.account.pageId ?? input.account.externalId, pageToken: input.token, recipientId: input.recipientId, message: input.message });
}
