import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QB Control Panel — Server Monitor",
  description: "Enterprise control panel for monitoring developments and production servers in real-time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
