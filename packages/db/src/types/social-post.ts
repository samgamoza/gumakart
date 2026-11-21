/**
 * Pull the platform post id out of whatever a seller pastes: a bare id, a Graph id
 * ("<pageId>_<postId>"), or a Facebook / Instagram / TikTok post URL.
 * Returns null when nothing usable is found (the UI then asks for the id itself).
 */
export interface ParsedPostRef {
  postId: string;
  platform: "facebook" | "instagram" | "tiktok" | "unknown";
}

export function parsePostReference(input: string): ParsedPostRef | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^\d{5,25}(_\d{5,25})?$/.test(raw)) return { postId: raw, platform: "unknown" };

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|web|mbasic)\./, "");
  const path = url.pathname;

  if (host === "facebook.com" || host === "fb.com" || host === "fb.watch") {
    const story = url.searchParams.get("story_fbid") ?? url.searchParams.get("fbid");
    const owner = url.searchParams.get("id");
    if (story && /^\d+$/.test(story)) return { postId: owner && /^\d+$/.test(owner) ? `${owner}_${story}` : story, platform: "facebook" };
    const m =
      /\/posts\/(?:[\w.-]+\/)?(\d{5,25})/.exec(path) ??
      /\/(?:reel|videos|watch)\/(?:[\w.-]+\/)?(\d{5,25})/.exec(path) ??
      /\/permalink\/(\d{5,25})/.exec(path);
    if (m) return { postId: m[1]!, platform: "facebook" };
    const v = url.searchParams.get("v");
    if (v && /^\d+$/.test(v)) return { postId: v, platform: "facebook" };
    return null;
  }
  if (host === "instagram.com") {
    const m = /\/(?:p|reel|tv)\/([\w-]{5,40})/.exec(path);
    return m ? { postId: m[1]!, platform: "instagram" } : null;
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = /\/video\/(\d{8,25})/.exec(path);
    return m ? { postId: m[1]!, platform: "tiktok" } : null;
  }
  return null;
}
