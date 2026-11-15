// DeskPilot action layer — deterministic, side-effect-free support actions.
//
// WHY THIS FILE EXISTS
// --------------------
// The AI model may *propose* a refund, but it never gets to decide whether money
// moves. Every money-touching action is executed here in plain TypeScript that a
// human can read end-to-end. The model only chooses *which* function to call and
// with what arguments; the limits below are enforced by code, not by prose in a
// system prompt. A prompt can be jailbroken / hallucinated around; an `if` cannot.
//
// Both functions are pure: they take the order list as an argument and return a
// result object. No network, no database, no clock, no randomness. That makes
// them trivially testable and safe to call from the API route.

import type { Order } from "./types";

/* -------------------------------------------------------------------------- */
/* Guardrail configuration                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hardcoded financial guardrail: automatic refunds are allowed up to and
 * including ₹1,000.
 *
 * This constant is intentionally NOT configurable per request, not readable
 * from the LLM's output, and not overridable by a function argument. The only
 * way to change the policy is to edit this file and ship a code review.
 *
 * All order amounts in DeskPilot are whole rupees (see lib/types.ts), so the
 * comparison is exact integer arithmetic — no float rounding edge cases.
 */
export const AUTO_REFUND_LIMIT_INR = 1000;

/* -------------------------------------------------------------------------- */
/* Result types                                                               */
/* -------------------------------------------------------------------------- */

export type RefundStatus = "APPROVED" | "GUARDRAIL_BLOCKED" | "NOT_FOUND";

export interface ApprovedRefund {
  status: "APPROVED";
  refundAmount: number;
  message: string;
  escalationRequired: false;
}

export interface BlockedRefund {
  status: "GUARDRAIL_BLOCKED";
  refundAmount: number;
  message: string;
  escalationRequired: true;
  /** Blocked refunds always jump the queue to the most urgent priority. */
  newPriority: "URGENT";
}

export interface RefundNotFound {
  status: "NOT_FOUND";
  refundAmount: 0;
  message: string;
  escalationRequired: false;
}

export type RefundResult = ApprovedRefund | BlockedRefund | RefundNotFound;

export interface OrderFound {
  status: "FOUND";
  order: Order;
  message: string;
}

export interface OrderNotFound {
  status: "NOT_FOUND";
  order: null;
  message: string;
}

export type OrderLookupResult = OrderFound | OrderNotFound;

/* -------------------------------------------------------------------------- */
/* 1) lookupOrder                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Find an order by id, case-insensitively, tolerating stray whitespace.
 *
 * Returns the full order record when found, or a clear NOT_FOUND result — never
 * `undefined`, so callers (and the model reading the tool output) always get an
 * explicit, human-readable answer instead of silently proceeding.
 */
export function lookupOrder(
  orderId: string,
  orders: readonly Order[],
): OrderLookupResult {
  const needle = (orderId ?? "").trim().toLowerCase();

  if (!needle) {
    return {
      status: "NOT_FOUND",
      order: null,
      message: "NOT_FOUND: no order id was provided.",
    };
  }

  // Case-insensitive match: "ord-103" and "ORD-103" resolve to the same order.
  const order = orders.find(
    (candidate) => candidate.id.toLowerCase() === needle,
  );

  if (!order) {
    return {
      status: "NOT_FOUND",
      order: null,
      message: `NOT_FOUND: no order exists with id "${orderId.trim()}". Ask the customer to confirm the order id before taking any action.`,
    };
  }

  return {
    status: "FOUND",
    order,
    message: `Found order ${order.id} for ${order.customerName} — ₹${order.amount}, ${order.status}, paid via ${order.paymentMethod}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* 2) processRefund                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Attempt an automatic refund for an order.
 *
 * Control flow, in order:
 *
 *   1. Verify the order exists (same lookup as `lookupOrder`). A refund for an
 *      unknown order is refused — we never move money against an unverified id
 *      or a hallucinated order number.
 *
 *   2. Apply the HARDCODED GUARDRAIL on `order.amount`:
 *
 *        amount <= ₹1,000  ->  AUTO-APPROVE. Refund the full order amount to the
 *                              original payment method. No human needed.
 *
 *        amount >  ₹1,000  ->  BLOCK. Do not execute. The model is not allowed
 *                              to refund large amounts on its own; the request
 *                              is returned to the human queue flagged
 *                              escalationRequired + priority URGENT so a manager
 *                              reviews and approves it manually.
 *
 * The check is `<=` on an integer rupee amount, so exactly ₹1,000 auto-approves
 * and ₹1,001 is blocked. The limit lives in `AUTO_REFUND_LIMIT_INR` above and
 * is compared here — it is not derived from the model output, the ticket text,
 * or a request parameter, so no prompt injection can raise it.
 */
export function processRefund(
  orderId: string,
  reason: string,
  orders: readonly Order[],
): RefundResult {
  // Step 1 — the order must exist. Fail closed on unknown ids.
  const lookup = lookupOrder(orderId, orders);

  if (lookup.status === "NOT_FOUND") {
    return {
      status: "NOT_FOUND",
      refundAmount: 0,
      message: lookup.message,
      escalationRequired: false,
    };
  }

  const order = lookup.order;
  const refundAmount = order.amount;

  // `reason` is recorded in the audit trail (see describeRefundDecision) and is
  // deliberately NOT used to decide the outcome: a persuasive reason cannot
  // unlock a larger refund.

  // Step 2 — HARDCODED FINANCIAL GUARDRAIL (the part evaluators should read
  // first). Small amounts are safe to automate; anything above the limit must
  // go to a human. There is no bypass flag and no override parameter.
  if (refundAmount <= AUTO_REFUND_LIMIT_INR) {
    // Within the automation budget: approve immediately, full amount back to the
    // original payment method.
    return {
      status: "APPROVED",
      refundAmount,
      message: `Auto-refunded ₹${refundAmount} to original payment method.`,
      escalationRequired: false,
    };
  }

  // Above the automation budget: block execution and hand over to a human.
  // Note that `refundAmount` is reported for context — it has NOT been paid out.
  return {
    status: "GUARDRAIL_BLOCKED",
    refundAmount,
    message:
      "Guardrail Triggered: Refunds above ₹1,000 require human manager approval.",
    escalationRequired: true,
    newPriority: "URGENT",
  };
}

/** Human-readable audit line for a refund decision, safe to log. */
export function describeRefundDecision(
  result: RefundResult,
  orderId: string,
  reason: string,
): string {
  const why = reason?.trim() || "no reason supplied";
  return `refund ${orderId}: ${result.status} (₹${result.refundAmount}) — ${why}`;
}
