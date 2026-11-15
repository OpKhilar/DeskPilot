import type { ChatReplyPayload } from "@/lib/actions";
import { ORDERS } from "@/lib/orders";
import { KB_SNIPPETS } from "@/lib/policies";

// POST /api/chat — deterministic support assistant for the demo simulator.
//
// Body: { message: string, orderId?: string }
//
// This is a policy router, not a model call: it classifies the message, quotes
// the knowledge base, and — for refunds — returns a tool call that the client
// executes through /api/actions, where the ₹1,000 ceiling is enforced in code.

type Intent =
  | "refund"
  | "tracking"
  | "returns"
  | "payments"
  | "serviceability"
  | "greeting"
  | "general";

const ORDER_ID_RE = /ORD[\s-]*(\d{2,6})/i;

function orderIdFromMessage(message: string): string | null {
  const match = ORDER_ID_RE.exec(message);
  return match ? `ORD-${match[1]}` : null;
}

function detectIntent(message: string): Intent {
  const text = message.toLowerCase();

  if (
    /port blair|andaman|island|deliver to|deliver karte|serviceab|pin ?code/.test(
      text,
    )
  ) {
    return "serviceability";
  }
  if (/refund|paisa|paise|money back|wapas|waapas|damage|damaged|toota|kharab/.test(text)) {
    return "refund";
  }
  if (/track|parcel|awb|kahan|kidhar|shipment|courier/.test(text)) {
    return "tracking";
  }
  if (/return window|return policy|return ke|exchange|replace/.test(text)) {
    return "returns";
  }
  if (/upi|payment|debited|kat gaye|failed|gateway/.test(text)) {
    return "payments";
  }
  if (/^(hi|hello|hey|namaste|namaskar)\b/.test(text.trim())) {
    return "greeting";
  }
  return "general";
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json(
      { error: "INVALID_BODY", message: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const body = payload as Record<string, unknown>;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return Response.json(
      { error: "MISSING_MESSAGE", message: "message is required." },
      { status: 400 },
    );
  }

  const bodyOrderId =
    typeof body.orderId === "string" && body.orderId.trim()
      ? body.orderId.trim()
      : null;
  const referencedOrderId = orderIdFromMessage(message) ?? bodyOrderId;
  const order = referencedOrderId
    ? ORDERS.find(
        (candidate) =>
          candidate.id.toLowerCase() === referencedOrderId.toLowerCase(),
      )
    : undefined;

  const intent = detectIntent(message);
  const empty: ChatReplyPayload = {
    reply: "",
    citations: [],
    actions: [],
    toolCall: null,
    knowledgeGap: false,
  };

  if (intent === "refund") {
    if (!referencedOrderId) {
      return Response.json({
        ...empty,
        reply:
          "I can help with the refund — could you share the order ID? It looks like ORD-104 and is on your invoice or confirmation SMS.",
      } satisfies ChatReplyPayload);
    }

    return Response.json({
      ...empty,
      // The client replaces this with the guardrail outcome from /api/actions.
      reply: `Checking ${referencedOrderId} against the refund policy now…`,
      citations: [KB_SNIPPETS.damagedItems, KB_SNIPPETS.refundTimeline],
      actions: order
        ? [
            {
              type: "order_lookup",
              label: `Linked order ${order.id}`,
              detail: `${order.items[0]?.name ?? "Order"} · ₹${order.amount} · ${order.paymentMethod} · ${order.status}`,
            },
          ]
        : [
            {
              type: "order_lookup",
              label: `Order ${referencedOrderId} not in the order book`,
              detail: "Asked the customer to re-check the order ID",
            },
          ],
      toolCall: {
        action: "process_refund",
        orderId: referencedOrderId,
        reason: message,
      },
    } satisfies ChatReplyPayload);
  }

  if (intent === "tracking") {
    if (!order) {
      return Response.json({
        ...empty,
        reply:
          "I can pull the latest shipment scan — please share the order ID (for example ORD-102).",
      } satisfies ChatReplyPayload);
    }

    const awb = order.awb ? ` with ${order.carrier ?? "our courier partner"} (AWB ${order.awb})` : "";

    return Response.json({
      ...empty,
      reply: `${order.id} is currently ${order.status.toLowerCase()}${awb}. Tracking links can take up to 6 hours to refresh after a scan, so the last update you see can look stale. Deliveries to ${order.customerCity} run in 3–6 working days.`,
      citations: [KB_SNIPPETS.tracking, KB_SNIPPETS.deliveryWindows],
      actions: [
        {
          type: "order_lookup",
          label: `Fetched shipment status · ${order.id}`,
          detail: order.awb
            ? `${order.status} · ${order.carrier ?? "courier"} ${order.awb}`
            : order.status,
        },
      ],
    } satisfies ChatReplyPayload);
  }

  if (intent === "returns") {
    return Response.json({
      ...empty,
      reply:
        "Returns are accepted within 7 days of delivery for unused, unwashed items with tags intact. Damaged, defective or wrong items must be reported within 48 hours with unboxing photos or a video, and those qualify for a full refund including shipping. Approved refunds reach the original payment method in 5–7 working days, or store credit within 24 hours.",
      citations: [KB_SNIPPETS.returnWindow, KB_SNIPPETS.damagedItems],
      actions: [
        {
          type: "knowledge_lookup",
          label: "Matched Return & Refund Policy v1.2",
          detail: "Return window · damaged item reporting · refund timeline",
        },
      ],
    } satisfies ChatReplyPayload);
  }

  if (intent === "payments") {
    return Response.json({
      ...empty,
      reply:
        "If money was debited but the order was not confirmed, the bank or UPI PSP auto-reverses it within 48 hours. Please don't retry the payment — that can create a duplicate order. Share the 12-digit UPI reference or a screenshot and I'll flag it for reconciliation.",
      citations: [KB_SNIPPETS.paymentFailures],
      actions: [
        {
          type: "knowledge_lookup",
          label: "Matched UPI & Payment Failures v1.2",
          detail: "Auto-reversal window · duplicate-order warning",
        },
      ],
    } satisfies ChatReplyPayload);
  }

  if (intent === "serviceability") {
    // The KB covers island delivery windows but has no serviceable pin-code
    // list, so this is an honest "I don't know" that must be logged.
    return Response.json({
      ...empty,
      reply:
        "Main confirm nahi kar sakta ki Port Blair serviceable hai ya nahi — policy mein island pin codes ke liye 7–10 working days likha hai, lekin serviceable pin code ki list nahi hai. Maine yeh question knowledge gap mein log kar diya hai, team verify karke aapko update degi.",
      knowledgeGap: true,
      actions: [
        {
          type: "knowledge_lookup",
          label: "No matching policy passage",
          detail: "Serviceable pin codes are not documented",
        },
      ],
    } satisfies ChatReplyPayload);
  }

  if (intent === "greeting") {
    return Response.json({
      ...empty,
      reply:
        "Hi! I can help with orders, refunds, returns and payments. Share an order ID and I'll pull it up.",
    } satisfies ChatReplyPayload);
  }

  return Response.json({
    ...empty,
    reply:
      "Thanks for reaching out. Could you share a little more detail — the order ID, the product, or what went wrong? I'll check it against our policies right away.",
    knowledgeGap: true,
    actions: [
      {
        type: "knowledge_lookup",
        label: "No KB passage matched",
        detail: "Message logged for the knowledge-gap review queue",
      },
    ],
  } satisfies ChatReplyPayload);
}
