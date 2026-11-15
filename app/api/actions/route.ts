// POST /api/actions — execute a DeskPilot support action.
//
// This route is the *only* way the AI layer is allowed to touch orders. It is a
// thin, stateless wrapper around lib/actions.ts:
//
//   { "action": "lookup_order",  "orderId": "ORD-103" }
//   { "action": "process_refund", "orderId": "ORD-104", "reason": "Damaged item" }
//
// The orders array is supplied by the caller (DeskPilot keeps demo data in the
// browser's localStorage), but the *decision* is never taken from the request:
// it is taken inside `processRefund`, where the ₹1,000 guardrail is hardcoded.
// A caller — or a model — cannot ask for a bigger refund than the guardrail
// allows; it can only ask, and the function answers.

import { NextResponse } from "next/server";
import { describeRefundDecision, lookupOrder, processRefund } from "@/lib/actions";
import type { Order } from "@/lib/types";

interface ActionRequest {
  action?: unknown;
  orderId?: unknown;
  reason?: unknown;
  orders?: unknown;
}

function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.amount === "number" &&
    Number.isFinite(candidate.amount)
  );
}

export async function POST(request: Request) {
  let body: ActionRequest;

  try {
    body = (await request.json()) as ActionRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { action, orderId, reason } = body;

  if (typeof orderId !== "string" || !orderId.trim()) {
    return NextResponse.json(
      { ok: false, error: "`orderId` is required." },
      { status: 400 },
    );
  }

  // Unknown or malformed order payloads are rejected, never guessed at.
  const orders = Array.isArray(body.orders) ? body.orders.filter(isOrder) : [];

  if (action === "lookup_order") {
    const result = lookupOrder(orderId, orders);
    return NextResponse.json(
      { ok: result.status === "FOUND", action, result },
      { status: result.status === "FOUND" ? 200 : 404 },
    );
  }

  if (action === "process_refund") {
    if (typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        { ok: false, error: "`reason` is required for a refund." },
        { status: 400 },
      );
    }

    const result = processRefund(orderId, reason, orders);

    // Status codes mirror the outcome so the caller cannot mistake a blocked
    // refund for a paid one: 200 approved, 409 blocked / not found.
    return NextResponse.json(
      {
        ok: result.status === "APPROVED",
        action,
        result,
        // Audit line for logs/escalation records; contains no model output.
        audit: describeRefundDecision(result, orderId, reason),
      },
      { status: result.status === "APPROVED" ? 200 : 409 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'Unknown action. Use "lookup_order" or "process_refund".',
    },
    { status: 400 },
  );
}

/** Small discovery helper so the console/agent can list available actions. */
export async function GET() {
  return NextResponse.json({
    actions: [
      {
        name: "lookup_order",
        input: { orderId: "string", orders: "Order[]" },
      },
      {
        name: "process_refund",
        input: { orderId: "string", reason: "string", orders: "Order[]" },
        guardrail: "Automatic refunds are capped at ₹1,000; above that a human manager must approve.",
      },
    ],
  });
}
