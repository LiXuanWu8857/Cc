import type { ReactNode } from "react";
import "./globals.css";
import { TabBar } from "@/components/TabBar";

export const metadata = {
  title: "FoodTrack",
  description: "飲食紀錄、營養分析與食品支出記帳。",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e8a78",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <TabBar />
      </body>
    </html>
  );
}
