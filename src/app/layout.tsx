import type { ReactNode } from "react";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { MenuDrawer } from "@/components/MenuDrawer";

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
      <body>
        <MenuDrawer />
        {children}
        <TabBar />
      </body>
    </html>
  );
}
