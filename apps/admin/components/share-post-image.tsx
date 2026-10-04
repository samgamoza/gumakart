"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { ImageDown, Loader2 } from "lucide-react";
import { productImageSrc } from "@/lib/product-image";

/**
 * Share kit (plan §5, 3C): a ready-to-post 1080×1080 image for Facebook / IG /
 * TikTok — product photo, name, price, shop name, the link and a QR code. Drawn
 * on a canvas in the browser; nothing is uploaded.
 */

export interface SharePostItem {
  title: string;
  quantity: number;
  price: string;
  imageUrl: string | null;
}

const SIZE = 1080;
const BRAND = "#6d28d9";

function peso(n: number): string {
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    // Local uploads come through the same-origin media proxy; remote photos need CORS,
    // otherwise the canvas would be tainted and can't be exported — then we skip the photo.
    if (/^https?:\/\//.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}

export async function drawSharePostImage(input: {
  items: SharePostItem[];
  shopName: string;
  url: string;
}): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const font = (weight: number, px: number) =>
    `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Photo (top 640px, cover-cropped)
  const photoH = 640;
  const first = input.items[0];
  const photo = await loadImage(productImageSrc(first?.imageUrl));
  if (photo) {
    const scale = Math.max(SIZE / photo.width, photoH / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    ctx.drawImage(photo, (SIZE - w) / 2, (photoH - h) / 2, w, h);
  } else {
    const grad = ctx.createLinearGradient(0, 0, SIZE, photoH);
    grad.addColorStop(0, "#ede9fe");
    grad.addColorStop(1, "#ddd6fe");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, photoH);
    ctx.fillStyle = BRAND;
    ctx.font = font(800, 72);
    ctx.textAlign = "center";
    const initials = wrapLines(ctx, first?.title ?? input.shopName, SIZE - 160, 2);
    initials.forEach((l, i) => ctx.fillText(l, SIZE / 2, photoH / 2 - 20 + i * 86));
    ctx.textAlign = "left";
  }

  // Shop name pill on the photo
  ctx.font = font(700, 34);
  const pillText = input.shopName;
  const pillW = Math.min(ctx.measureText(pillText).width + 56, SIZE - 96);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundRect(ctx, 48, 48, pillW, 68, 34);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillText(wrapLines(ctx, pillText, pillW - 56, 1)[0] ?? "", 76, 94);

  // Details panel
  const left = 56;
  const qrSize = 260;
  const textMax = SIZE - left - qrSize - 96;
  const extra = input.items.length - 1;
  const title = first ? `${first.quantity > 1 ? `${first.quantity}× ` : ""}${first.title}` : "";
  ctx.fillStyle = "#111827";
  ctx.font = font(800, 54);
  const titleLines = wrapLines(ctx, title, textMax, 2);
  let y = photoH + 84;
  for (const l of titleLines) {
    ctx.fillText(l, left, y);
    y += 64;
  }
  if (extra > 0) {
    ctx.font = font(600, 32);
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`+ ${extra} more item${extra > 1 ? "s" : ""}`, left, y - 10);
    y += 34;
  }
  const total = input.items.reduce((sum, i) => sum + Number(i.price || 0) * i.quantity, 0);
  ctx.font = font(800, 64);
  ctx.fillStyle = BRAND;
  ctx.fillText(peso(total), left, y + 22);

  // QR
  const qrUrl = await QRCode.toDataURL(input.url, { margin: 1, width: qrSize, errorCorrectionLevel: "M" });
  const qr = await loadImage(qrUrl);
  const qrX = SIZE - qrSize - 56;
  const qrY = photoH + 36;
  if (qr) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 18);
    ctx.fill();
    ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
  }

  // Bottom bar with the link
  const barH = 120;
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, SIZE - barH, SIZE, barH);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(600, 30);
  ctx.fillText("Order here — no app or account needed", left, SIZE - barH + 46);
  ctx.font = font(800, 40);
  const shortUrl = input.url.replace(/^https?:\/\//, "");
  ctx.fillText(wrapLines(ctx, shortUrl, SIZE - left * 2, 1)[0] ?? shortUrl, left, SIZE - barH + 94);

  return canvasToBlob(canvas);
}

let cachedShopName: string | null = null;

async function getShopName(): Promise<string> {
  if (cachedShopName) return cachedShopName;
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    cachedShopName = (data?.settings?.name as string | undefined) ?? "";
  } catch {
    cachedShopName = "";
  }
  return cachedShopName || "Order now";
}

export function SharePostImageButton({
  code,
  items,
  url,
  className,
}: {
  code: string;
  items: SharePostItem[];
  url: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await drawSharePostImage({ items, url, shopName: await getShopName() });
      if (!blob) throw new Error("no image");
      const file = new File([blob], `guma-post-${code}.png`, { type: "image/png" });
      // Phones: open the share sheet with the image so it goes straight to FB / IG.
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] }) && window.matchMedia("(pointer: coarse)").matches) {
        await nav.share({ files: [file] }).catch(() => undefined);
      } else {
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 5000);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void run()} disabled={busy} data-testid="share-post-image">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
      {failed ? "Try again" : "Post image"}
    </button>
  );
}
