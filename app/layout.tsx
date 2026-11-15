import type { Metadata } from "next";
import "./globals.css";
import { ensureRagStore } from "@/lib/ragEngine";
import { DeskStoreProvider } from "@/lib/store";

// Seed the local RAG database when the server side of the app boots, so
// data/rag-store.json is ready before the first retrieval. Fire-and-forget:
// a filesystem problem must never block rendering, and the engine retries on
// first use.
if (process.env.NEXT_RUNTIME === "nodejs") {
  void ensureRagStore().catch((error) => {
    console.error(
      "[deskpilot] Could not seed the RAG store:",
      error instanceof Error ? error.message : error,
    );
  });
}

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
