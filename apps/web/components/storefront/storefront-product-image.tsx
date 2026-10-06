"use client";

import { sizedImageUrl, sizedSrcSet } from "@/lib/image-sizes";
import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * Product photos from seller uploads are served from /uploads/products/*.
 * Use a plain img for those so local disk files work without next/image quirks; Phase 20 adds a
 * srcset of resized copies (?w=) so phones download a small WebP, not the full upload.
 * Remote (https / Unsplash) URLs still go through next/image.
 */
export function StorefrontProductImage({
  src,
  alt,
  fill,
  width,
  height,
  sizes,
  className,
  style,
  priority,
}: {
  src: string;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
}) {
  const isLocalUpload =
    src.startsWith("/uploads/") ||
    src.includes("/uploads/products/");

  if (isLocalUpload) {
    if (fill) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sizedImageUrl(src, width ?? 600)}
          srcSet={sizedSrcSet(src, width ?? 600)}
          sizes={sizes ?? "(max-width: 640px) 50vw, 300px"}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          className={className}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            ...style,
          }}
        />
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sizedImageUrl(src, width ?? 600)}
        srcSet={sizedSrcSet(src, width ?? 600)}
        sizes={sizes ?? (width ? `${width}px` : "(max-width: 640px) 50vw, 300px")}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        width={width}
        height={height}
        className={className}
        style={style}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill={fill}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      className={className}
      style={style}
      priority={priority}
    />
  );
}
