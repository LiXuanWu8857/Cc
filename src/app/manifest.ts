import type { MetadataRoute } from "next";

/** PWA manifest — names the app "食記" and supplies the Cc home-screen icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "食記",
    short_name: "食記",
    description: "飲食紀錄、營養分析與食品支出記帳。",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#ef5f96",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
