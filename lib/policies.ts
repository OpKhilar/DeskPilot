import type { Citation } from "./types";

// Passages quoted by the API routes, copied from the demo knowledge base in
// lib/store.ts. Snippets are kept verbatim so a citation always matches the
// policy text an agent can open in the console.

export const KB_SNIPPETS = {
  returnWindow: {
    docId: "kb-return-refund",
    title: "Return & Refund Policy",
    version: "v1.2",
    snippet:
      "Customers may raise a return within 7 days of delivery for unused, unwashed items with tags intact.",
    matchScore: 89,
  },
  damagedItems: {
    docId: "kb-return-refund",
    title: "Return & Refund Policy",
    version: "v1.2",
    snippet:
      "Damaged, defective or wrong items must be reported within 48 hours of delivery with unboxing photos or a video; these qualify for a full refund including shipping.",
    matchScore: 93,
  },
  refundTimeline: {
    docId: "kb-return-refund",
    title: "Return & Refund Policy",
    version: "v1.2",
    snippet:
      "Approved refunds are credited to the original payment method within 5–7 working days, or to store credit within 24 hours if the customer prefers.",
    matchScore: 91,
  },
  tracking: {
    docId: "kb-shipping",
    title: "Shipping Timelines",
    version: "v1.2",
    snippet:
      "Tracking links activate within 24 hours of dispatch and sometimes take up to 6 hours to refresh after a scan.",
    matchScore: 87,
  },
  deliveryWindows: {
    docId: "kb-shipping",
    title: "Shipping Timelines",
    version: "v1.2",
    snippet:
      "Metro pin codes are delivered in 2–4 working days, tier-2 cities in 3–6 working days and North-East, Jammu & Kashmir, Himachal and island pin codes in 7–10 working days.",
    matchScore: 84,
  },
  paymentFailures: {
    docId: "kb-payments",
    title: "UPI & Payment Failures",
    version: "v1.2",
    snippet:
      "If money was debited but the order was not confirmed, the amount is auto-reversed by the bank or UPI PSP within 48 hours.",
    matchScore: 90,
  },
} satisfies Record<string, Citation>;
