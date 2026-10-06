import type { MetadataRoute } from "next";

/** The seller dashboard installs to the home screen like an app (Android "Install app", iOS "Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Guma Kart Seller",
    short_name: "Guma Seller",
    description: "Orders, products, POS and payments for your Guma Kart shop.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
