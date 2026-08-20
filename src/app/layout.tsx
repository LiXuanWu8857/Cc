import type { ReactNode } from "react";

export const metadata = {
  title: "FoodTrack",
  description: "Diet, nutrition and food-spending tracker.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
