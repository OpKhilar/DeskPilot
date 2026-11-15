import { lookupOrder, processRefund } from "@/lib/actions";
import { ORDERS } from "@/lib/orders";

// POST /api/actions — deterministic e-commerce support actions.
//
// Body: { action: "lookup_order" | "process_refund", orderId, reason? }
// Money limits are enforced in lib/actions.ts, never by the caller.

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
  const action = body.action;
  const orderId = typeof body.orderId === "string" ? body.orderId : "";

  if (action !== "lookup_order" && action !== "process_refund") {
    return Response.json(
      {
        error: "UNKNOWN_ACTION",
        message: "Unsupported action. Use lookup_order or process_refund.",
      },
      { status: 400 },
    );
  }

  if (!orderId.trim()) {
    return Response.json(
      { error: "MISSING_ORDER_ID", message: "orderId is required." },
      { status: 400 },
    );
  }

  if (action === "lookup_order") {
    const result = lookupOrder(orderId, ORDERS);
    return Response.json(result, { status: result.found ? 200 : 404 });
  }

  const reason = typeof body.reason === "string" ? body.reason : "";
  const result = processRefund(orderId, reason, ORDERS);

  // A missing order is a 404; approved and blocked refunds are both 200 — the
  // block is a business outcome, not a transport error.
  return Response.json(result, {
    status: result.status === "NOT_FOUND" ? 404 : 200,
  });
}
