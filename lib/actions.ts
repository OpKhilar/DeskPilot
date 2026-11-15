import type { Citation, NewActionLog, Order } from "./types";

// Deterministic support actions and the money guardrail.
//
// The refund ceiling is a constant in this module, not a sentence in a prompt:
// no matter what the model or the browser asks for, processRefund is the only
// code path that can approve a refund and it refuses anything above the limit.

/** Refunds at or below this amount may execute without a human. */
export const AUTO_REFUND_LIMIT = 1000;

export interface OrderFoundResult {
  status: "FOUND";
  found: true;
  order: Order;
}

export interface OrderNotFoundResult {
  status: "NOT_FOUND";
  found: false;
  orderId: string;
  message: string;
}

export type LookupResult = OrderFoundResult | OrderNotFoundResult;

export interface RefundApproved {
  status: "APPROVED";
  refundAmount: number;
  message: string;
  escalationRequired: false;
}

export interface RefundBlocked {
  status: "GUARDRAIL_BLOCKED";
  refundAmount: number;
  message: string;
  escalationRequired: true;
  newPriority: "URGENT";
}

export interface RefundNotFound {
  status: "NOT_FOUND";
  message: string;
  escalationRequired: false;
}

export type RefundResult = RefundApproved | RefundBlocked | RefundNotFound;

/** Case-insensitive order lookup. Never throws on a missing id. */
export function lookupOrder(
  orderId: string,
  orders: readonly Order[],
): LookupResult {
  const needle = orderId.trim().toLowerCase();
  const order = orders.find((candidate) => candidate.id.toLowerCase() === needle);

  if (!order) {
    return {
      status: "NOT_FOUND",
      found: false,
      orderId: orderId.trim(),
      message: `NOT_FOUND: No order matches ${orderId.trim() || "(empty id)"}. Check the order ID and try again.`,
    };
  }

  return { status: "FOUND", found: true, order };
}

/**
 * Refund decision. Verifies the order, then applies the hardcoded ceiling:
 * ≤ ₹1,000 executes, anything above is blocked and escalated.
 */
export function processRefund(
  orderId: string,
  reason: string,
  orders: readonly Order[],
): RefundResult {
  // `reason` is logged by the caller; the decision never depends on its wording.
  void reason;

  const lookup = lookupOrder(orderId, orders);

  if (!lookup.found) {
    return {
      status: "NOT_FOUND",
      message: `NOT_FOUND: No order matches ${orderId.trim() || "(empty id)"}. Refund not processed.`,
      escalationRequired: false,
    };
  }

  const { order } = lookup;

  if (order.amount <= AUTO_REFUND_LIMIT) {
    return {
      status: "APPROVED",
      refundAmount: order.amount,
      message: `Auto-refunded ₹${order.amount} to original payment method.`,
      escalationRequired: false,
    };
  }

  return {
    status: "GUARDRAIL_BLOCKED",
    refundAmount: order.amount,
    message:
      "Guardrail Triggered: Refunds above ₹1,000 require human manager approval.",
    escalationRequired: true,
    newPriority: "URGENT",
  };
}

/* -------------------------------------------------------------------------- */
/* /api/chat contract                                                         */
/* -------------------------------------------------------------------------- */

export interface ChatToolCall {
  action: "process_refund";
  orderId: string;
  reason: string;
}

export interface ChatReplyPayload {
  /** Assistant text. Empty when the caller should execute `toolCall` first. */
  reply: string;
  citations: Citation[];
  actions: NewActionLog[];
  /** Set when the turn needs a deterministic money action via /api/actions. */
  toolCall: ChatToolCall | null;
  /** True when the question had no grounded answer and must be logged. */
  knowledgeGap: boolean;
}
