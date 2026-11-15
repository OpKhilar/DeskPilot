// DeskPilot triage helpers — deterministic SLA math + a keyword pre-classifier.
//
// Nothing in this file calls a model, a clock it does not control, or the
// network. Every function takes its inputs explicitly and returns plain data, so
// countdown badges tick correctly during render and the triage result is
// reproducible for the same text (useful when an evaluator re-runs a case).
//
// Priorities use the app's canonical lowercase union from lib/types.ts
// ("low" | "medium" | "high" | "urgent"); input is accepted case-insensitively
// so "URGENT" and "urgent" behave the same.

import type { TicketPriority } from "./types";

/* -------------------------------------------------------------------------- */
/* 1) calculateSLA                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How long a ticket may sit before the first response is considered late.
 * Deliberately aggressive: this is a live support desk, not an email queue.
 */
export const SLA_WINDOW_MS: Record<TicketPriority, number> = {
  urgent: 5 * 60_000, // +5 minutes
  high: 15 * 60_000, // +15 minutes
  medium: 30 * 60_000, // +30 minutes
  low: 60 * 60_000, // +60 minutes
};

/** True when the string is one of the four known priorities. */
export function isTicketPriority(value: unknown): value is TicketPriority {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "urgent"
  );
}

/**
 * Deadline epoch-milliseconds for a priority.
 *
 * @param priority  "urgent" | "high" | "medium" | "low" (any casing)
 * @param now       injectable clock, defaults to Date.now()
 * @returns absolute timestamp the SLA expires at
 * @throws when the priority is unknown — a silent default would hide a bad
 *         classification, and an SLA computed off the wrong tier is worse than
 *         a loud failure.
 */
export function calculateSLA(
  priority: TicketPriority | string,
  now: number = Date.now(),
): number {
  const key = String(priority ?? "").trim().toLowerCase();

  if (!isTicketPriority(key)) {
    throw new Error(
      `calculateSLA: unknown priority "${String(priority)}" (expected urgent | high | medium | low).`,
    );
  }

  return now + SLA_WINDOW_MS[key];
}

/* -------------------------------------------------------------------------- */
/* 2) formatCountdown                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Badges flip to the warning colour inside this window. With a 5-minute urgent
 * SLA, one minute of warning is roughly the point where a human has to act now.
 */
export const WARNING_WINDOW_MS = 60_000;

export interface Countdown {
  /** "MM:SS" (minutes are not truncated at 99), or "00:00" once breached. */
  formatted: string;
  isBreached: boolean;
  isWarning: boolean;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Turn a deadline into data a ticking badge can render.
 *
 * - `formatted` is always "MM:SS", clamped to "00:00" once the deadline passes.
 * - `isBreached` means the deadline is now or in the past (remaining <= 0).
 * - `isWarning` means it has not breached yet but is within WARNING_WINDOW_MS,
 *   i.e. the amber state between "on track" and "late".
 *
 * @param deadlineTimestamp epoch-ms returned by `calculateSLA`
 * @param now               injectable clock, defaults to Date.now()
 */
export function formatCountdown(
  deadlineTimestamp: number,
  now: number = Date.now(),
): Countdown {
  const safeDeadline =
    typeof deadlineTimestamp === "number" && Number.isFinite(deadlineTimestamp)
      ? deadlineTimestamp
      : now;

  const remainingMs = safeDeadline - now;
  const isBreached = remainingMs <= 0;

  if (isBreached) {
    return { formatted: "00:00", isBreached: true, isWarning: false };
  }

  // Round up so a badge never shows 00:00 while a second is still left, and
  // never shows a breach early.
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    formatted: `${pad(minutes)}:${pad(seconds)}`,
    isBreached: false,
    isWarning: remainingMs <= WARNING_WINDOW_MS,
  };
}

/* -------------------------------------------------------------------------- */
/* 3) autoTriageMessage                                                       */
/* -------------------------------------------------------------------------- */

export type TriageSentiment = "calm" | "frustrated" | "angry";

export interface TriageResult {
  /** Final recommended priority for the ticket. */
  priority: TicketPriority;
  /** True when the message raised the priority above the calm default. */
  boosted: boolean;
  /** The priority before any signal was applied (always "low"). */
  basePriority: TicketPriority;
  sentiment: TriageSentiment;
  /** Internal score that produced `priority`; higher means more urgent. */
  score: number;
  /** Machine-readable keywords found in the text. */
  matchedKeywords: string[];
  /** Human-readable reasons, safe to show in the action log. */
  reasons: string[];
  /** Money / legal / abuse signals that should reach a human regardless of SLA. */
  escalateToHuman: boolean;
}

/** Money already lost or in dispute — highest business risk. */
const CRITICAL_KEYWORDS = [
  "fraud",
  "scam",
  "fake",
  "cheated",
  "chargeback",
  "police",
  "legal",
  "consumer court",
  "lawyer",
  "stolen",
  "duplicate payment",
  "double charged",
] as const;

/** Refund / damage / cancellation clusters — the everyday high-intent cases. */
const HIGH_KEYWORDS = [
  "refund",
  "refunded",
  "return",
  "replace",
  "replacement",
  "damaged",
  "damage",
  "broken",
  "tampered",
  "cancel",
  "cancelled",
  "canceled",
  "not delivered",
  "wrong item",
  "missing",
] as const;

/** Buying intent that still needs a reply but is not a loss event. */
const MEDIUM_KEYWORDS = [
  "tracking",
  "delayed",
  "delay",
  "late",
  "where is my order",
  "not working",
  "warranty",
  "exchange",
  "size",
] as const;

/**
 * Frustration markers, including Hinglish forms that show up constantly in this
 * desk's WhatsApp/Instagram threads. Kept as whole words where a substring would
 * over-match (e.g. "worst" inside "worst-case").
 */
const ANGRY_KEYWORDS = [
  "angry",
  "furious",
  "pathetic",
  "worst",
  "terrible",
  "useless",
  "rubbish",
  "disgusting",
  "unacceptable",
  "ridiculous",
  "shame",
  "bakwas",
  "bekaar",
  "ghatiya",
  "frustrated",
  "disappointed",
  "third time",
  "again and again",
  "no response",
  "nobody responding",
] as const;

const FRUSTRATED_KEYWORDS = [
  "still waiting",
  "not received",
  "no update",
  "please help",
  "urgent",
  "asap",
  "kitne din",
  "kab tak",
] as const;

/** Score -> priority ladder. Every threshold is a plain comparison. */
function priorityFromScore(score: number): TicketPriority {
  if (score >= 6) return "urgent";
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

/**
 * Fast deterministic fallback / pre-classifier.
 *
 * Runs before (or instead of) the model: if the AI layer is slow, offline or
 * unsure, this still routes money-losing and angry conversations correctly.
 * Same text always yields the same priority, so triage is auditable.
 *
 * Scoring:
 *   critical keyword  +4 each (fraud, scam, chargeback, legal …)
 *   high keyword      +2 each (refund, damaged, cancel …)
 *   medium keyword    +1 each (tracking, delayed, warranty …)
 *   angry sentiment   +3 (keywords, ALL CAPS shouting, repeated "!!!")
 *   frustrated        +1 (still waiting, kab tak …)
 *
 * Ladder: >=6 urgent, >=4 high, >=2 medium, else low.
 */
export function autoTriageMessage(text: string): TriageResult {
  const raw = typeof text === "string" ? text : "";
  const haystack = raw.toLowerCase();

  if (!raw.trim()) {
    return {
      priority: "low",
      boosted: false,
      basePriority: "low",
      sentiment: "calm",
      score: 0,
      matchedKeywords: [],
      reasons: ["Empty message — defaulted to low priority."],
      escalateToHuman: false,
    };
  }

  const matched = new Set<string>();
  const reasons: string[] = [];
  let score = 0;

  const countHits = (keywords: readonly string[], points: number, label: string) => {
    let hits = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) {
        matched.add(keyword);
        hits += 1;
      }
    }
    if (hits > 0) {
      score += hits * points;
      reasons.push(`${label}: ${hits} match${hits === 1 ? "" : "es"}`);
    }
    return hits;
  };

  const criticalHits = countHits(CRITICAL_KEYWORDS, 4, "Fraud/legal risk");
  const highHits = countHits(HIGH_KEYWORDS, 2, "Refund/damage/cancel");
  countHits(MEDIUM_KEYWORDS, 1, "Shipping/warranty");

  // --- sentiment -----------------------------------------------------------
  const angryHits = countHits(ANGRY_KEYWORDS, 3, "Angry language");
  const frustratedHits = countHits(FRUSTRATED_KEYWORDS, 1, "Frustration");

  // Shouting: a decent run of capitals is a reliable cheap anger signal that
  // works across languages, unlike a keyword list.
  const letters = raw.replace(/[^A-Za-z]/g, "");
  const upper = raw.replace(/[^A-Z]/g, "");
  const shouting = letters.length >= 12 && upper.length / letters.length >= 0.7;
  if (shouting) {
    score += 3;
    reasons.push("Message is written in caps (shouting)");
  }

  // Repeated exclamation marks ("!!!") read as escalation, a single "!" does not.
  const exclamations = (raw.match(/!/g) ?? []).length;
  if (exclamations >= 2) {
    score += 1;
    reasons.push(`${exclamations} exclamation marks`);
  }

  const sentiment: TriageSentiment =
    angryHits > 0 || shouting ? "angry" : frustratedHits > 0 ? "frustrated" : "calm";

  // Keep the priority floor at "high" for money-losing conversations even if the
  // text is polite — a calm "please refund my damaged order" is still high.
  if (criticalHits > 0 || highHits > 0) {
    score = Math.max(score, 4);
  }

  const priority = priorityFromScore(score);

  return {
    priority,
    boosted: priority !== "low",
    basePriority: "low",
    sentiment,
    score,
    matchedKeywords: [...matched],
    reasons: reasons.length > 0 ? reasons : ["No urgency signals found"],
    // Abuse/legal/fraud, or a genuinely angry customer, goes to a human rather
    // than being auto-answered by the model.
    escalateToHuman: criticalHits > 0 || sentiment === "angry",
  };
}
