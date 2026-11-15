import type { Metadata } from "next";
import "./globals.css";
import { DeskStoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "DeskPilot — Support Command Center",
  description:
    "DeskPilot is an AI-assisted support desk for Indian D2C brands: orders, policy-grounded replies, escalations and knowledge gaps.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <DeskStoreProvider>{children}</DeskStoreProvider>
      </body>
    </html>
  );
}
