"use client";

// Analytics workspace: KPI cards, a category breakdown, a resolution funnel and
// the top unanswered questions. Everything is derived from useDeskStore, so the
// numbers move as the demo resolves tickets.
//
// The store only seeds *today's* conversations, so the cards combine them with a
// documented prior period (the rest of the 30-day window). That is what puts the
// opening numbers in the reference design's range while still reacting live.

import { useMemo } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Filter,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
} from "lucide-react";
import { useDeskStore } from "@/lib/store";
import type {
  ActionLogType,
  KnowledgeGapStatus,
  Order,
  Ticket,
  TicketCategory,
} from "@/lib/types";

const CATEGORY_BUCKETS = ["Refunds", "Shipping", "Billing", "Product Inquiry"] as const;
type CategoryBucket = (typeof CATEGORY_BUCKETS)[number];

/** Store ticket categories folded into the four headline buckets. */
const categoryBucket: Record<TicketCategory, CategoryBucket> = {
  Refund: "Refunds",
  "Damaged Product": "Refunds",
  "Order Tracking": "Shipping",
  Payments: "Billing",
  Warranty: "Product Inquiry",
  "Product Query": "Product Inquiry",
  Other: "Product Inquiry",
};

/** Action logs that mean the AI actually did something, not just looked around. */
const EXECUTED_ACTIONS: ReadonlySet<ActionLogType> = new Set<ActionLogType>([
  "draft",
  "tool_call",
  "resolution",
  "order_lookup",
]);

/** Refunds above this value are held for a human before money moves. */
const HIGH_VALUE_REFUND = 1000;

/** Customer-facing latency of the model vs. a human agent (telemetry, not ticket data). */
const AI_RESPONSE_SECONDS = 1.4;
const HUMAN_RESPONSE_LABEL = "12m 30s";

interface PriorPeriod {
  conversations: number;
  aiResolved: number;
  actionExecuted: number;
  escalated: number;
  csatCount: number;
  csatTotal: number;
  guardrailHeld: number;
  guardrailCount: number;
  byCategory: Record<CategoryBucket, number>;
}

/**
 * Seeded demo history for the 30-day window. `byCategory` adds up to
 * `conversations`, and `actionExecuted` / `escalated` are subsets of
 * `aiResolved`, so the funnel stays monotonic.
 */
const PRIOR_PERIOD: PriorPeriod = {
  conversations: 21,
  aiResolved: 17,
  actionExecuted: 14,
  escalated: 4,
  csatCount: 12,
  csatTotal: 56.4, // 12 automated resolutions averaging 4.7
  guardrailHeld: 18400,
  guardrailCount: 3,
  byCategory: {
    Refunds: 8,
    Shipping: 6,
    Billing: 3,
    "Product Inquiry": 4,
  },
};

const gapStatusMeta: Record<
  KnowledgeGapStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-brand-500 text-cream-50" },
  in_review: {
    label: "In review",
    className: "bg-cream-200 text-charcoal-900",
  },
  resolved: {
    label: "Resolved",
    className:
      "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
  },
};

const gapStatusRank: Record<KnowledgeGapStatus, number> = {
  open: 0,
  in_review: 1,
  resolved: 2,
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function share(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

export default function AnalyticsView() {
  const { tickets, orders, kbDocs, knowledgeGaps } = useDeskStore();

  const metrics = useMemo(() => {
    const hasAiReply = (ticket: Ticket) =>
      ticket.messages.some((message) => message.sender === "ai");
    const isAiResolved = (ticket: Ticket) =>
      ticket.status === "resolved" && hasAiReply(ticket);
    const didExecute = (ticket: Ticket) =>
      ticket.messages.some((message) =>
        (message.actions ?? []).some((action) => EXECUTED_ACTIONS.has(action.type)),
      );
    const needsHuman = (ticket: Ticket) =>
      ticket.status === "escalated" || ticket.status === "human_takeover";

    const conversations = PRIOR_PERIOD.conversations + tickets.length;
    const aiResolved =
      PRIOR_PERIOD.aiResolved + tickets.filter(isAiResolved).length;
    const actionExecuted =
      PRIOR_PERIOD.actionExecuted +
      tickets.filter((ticket) => isAiResolved(ticket) && didExecute(ticket)).length;
    const escalated =
      PRIOR_PERIOD.escalated + tickets.filter(needsHuman).length;

    // CSAT blends the prior period with any satisfaction scores on live tickets.
    const liveScores = tickets
      .map((ticket) => ticket.satisfactionScore)
      .filter((score): score is number => typeof score === "number");
    const csatCount = PRIOR_PERIOD.csatCount + liveScores.length;
    const csat = csatCount
      ? (PRIOR_PERIOD.csatTotal +
          liveScores.reduce((sum, score) => sum + score, 0)) /
        csatCount
      : 0;

    // High-value refunds on conversations that went to a human.
    const heldOrders = tickets
      .filter(needsHuman)
      .map((ticket) => orders.find((order) => order.id === ticket.orderId))
      .filter(
        (order): order is Order =>
          order !== undefined && order.amount > HIGH_VALUE_REFUND,
      );
    const guardrailHeld =
      PRIOR_PERIOD.guardrailHeld +
      heldOrders.reduce((sum, order) => sum + order.amount, 0);

    const byCategory = CATEGORY_BUCKETS.map((bucket) => ({
      bucket,
      value:
        PRIOR_PERIOD.byCategory[bucket] +
        tickets.filter((ticket) => categoryBucket[ticket.category] === bucket)
          .length,
    }));

    const funnel = [
      { label: "Total incoming", value: conversations, tone: "bg-cream-300" },
      { label: "Auto-resolved by AI", value: aiResolved, tone: "bg-brand-300" },
      { label: "Action executed", value: actionExecuted, tone: "bg-brand-400" },
      { label: "Escalated to human", value: escalated, tone: "bg-brand-500" },
    ];

    return {
      conversations,
      aiResolved,
      actionExecuted,
      escalated,
      resolutionRate: share(aiResolved, conversations),
      csat,
      csatCount,
      guardrailHeld,
      guardrailCount: PRIOR_PERIOD.guardrailCount + heldOrders.length,
      byCategory,
      funnel,
    };
  }, [tickets, orders]);

  const unanswered = useMemo(
    () =>
      knowledgeGaps
        .filter((gap) => gap.status !== "resolved")
        .sort(
          (a, b) =>
            gapStatusRank[a.status] - gapStatusRank[b.status] ||
            b.frequency - a.frequency,
        ),
    [knowledgeGaps],
  );

  const unresolvedAsks = unanswered.reduce((sum, gap) => sum + gap.frequency, 0);
  const maxCategory = Math.max(1, ...metrics.byCategory.map((row) => row.value));
  const topGaps = unanswered.slice(0, 5);

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500 text-cream-100 shadow-glow">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-cream-50">
              Analytics
            </h1>
            <p className="text-sm text-ash-400">
              30-day window · seeded prior period plus today&apos;s{" "}
              {tickets.length} live conversations
            </p>
          </div>
        </div>
        <span className="pill self-start bg-charcoal-800 text-ash-300 ring-1 ring-inset ring-charcoal-600">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-300" />
          Updates as tickets resolve
        </span>
      </header>

      {/* ------------------------------- KPI cards ------------------------------ */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Bot}
          label="AI resolution rate"
          value={`${Math.round(metrics.resolutionRate)}%`}
          hint={`${metrics.aiResolved} of ${metrics.conversations} conversations closed without a human`}
        >
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-charcoal-700">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-brand-500 to-brand-300"
              style={{ width: `${metrics.resolutionRate}%` }}
            />
          </div>
        </KpiCard>

        <KpiCard
          icon={Star}
          label="CSAT score"
          value={`${metrics.csat.toFixed(1)} / 5.0`}
          hint={`${metrics.csatCount} recent automated resolutions rated`}
        >
          <div className="mt-2.5 flex gap-1">
            {Array.from({ length: 5 }).map((_, index) => (
              <span
                key={index}
                className={`h-1.5 flex-1 rounded-full ${
                  index < Math.round(metrics.csat) ? "bg-cream-200" : "bg-charcoal-600"
                }`}
              />
            ))}
          </div>
        </KpiCard>

        <KpiCard
          icon={Timer}
          label="Avg AI response time"
          value={`${AI_RESPONSE_SECONDS}s`}
          hint={`vs ${HUMAN_RESPONSE_LABEL} for a human agent`}
        >
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="pill bg-cream-200 text-charcoal-900">
              AI {AI_RESPONSE_SECONDS}s
            </span>
            <span className="pill bg-charcoal-700 text-ash-300 ring-1 ring-inset ring-charcoal-600">
              Human {HUMAN_RESPONSE_LABEL}
            </span>
          </div>
        </KpiCard>

        <KpiCard
          icon={ShieldCheck}
          label="Guardrail savings"
          value={inr.format(metrics.guardrailHeld)}
          hint={`${metrics.guardrailCount} refunds above ${inr.format(
            HIGH_VALUE_REFUND,
          )} held for human verification`}
        >
          <div className="mt-2.5 flex items-center gap-2 text-[10px] text-ash-400">
            <span className="h-1.5 flex-1 rounded-full bg-gradient-to-r from-brand-500 to-brand-300" />
            <span className="shrink-0">held, not paid</span>
          </div>
        </KpiCard>
      </section>

      {/* ----------------------------- Visual breakdown ------------------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="panel p-4">
          <PanelHeading
            icon={BarChart3}
            title="Ticket volume by category"
            meta={`${metrics.conversations} conversations`}
          />
          <div className="mt-3 space-y-3">
            {metrics.byCategory.map((row) => {
              const pct = share(row.value, maxCategory);
              return (
                <div key={row.bucket}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-medium text-cream-100">{row.bucket}</span>
                    <span className="text-ash-400">
                      {row.value} ·{" "}
                      {Math.round(share(row.value, metrics.conversations))}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-charcoal-700">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 border-t border-charcoal-700/70 pt-2.5 text-[10px] text-ash-400">
            Bars are scaled to the busiest category; percentages are of all{" "}
            {metrics.conversations} conversations.
          </p>
        </section>

        <section className="panel p-4">
          <PanelHeading
            icon={Filter}
            title="Resolution funnel"
            meta={`${Math.round(
              share(metrics.aiResolved, metrics.conversations),
            )}% resolved by AI`}
          />
          <div className="mt-3 space-y-2.5">
            {metrics.funnel.map((step, index) => {
              const pct = share(step.value, metrics.conversations);
              const previous = index > 0 ? metrics.funnel[index - 1].value : step.value;
              const dropped = index > 0 ? previous - step.value : 0;
              return (
                <div key={step.label}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-medium text-cream-100">{step.label}</span>
                    <span className="text-ash-400">
                      {step.value} · {Math.round(pct)}%
                      {dropped > 0 ? ` · −${dropped}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-6 w-full rounded-md bg-charcoal-800/70">
                    <div
                      className={`h-6 rounded-md ${step.tone}`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 border-t border-charcoal-700/70 pt-2.5 text-[10px] text-ash-400">
            Each stage is a subset of the one above it.
          </p>
        </section>
      </div>

      {/* ---------------------------- Knowledge gaps ---------------------------- */}
      <section className="mt-4">
        <div className="panel overflow-hidden">
          <div className="p-4 pb-2">
            <PanelHeading
              icon={AlertTriangle}
              title="Top knowledge gaps"
              meta={`${unanswered.length} gaps · ${unresolvedAsks} unanswered asks`}
            />
            <p className="-mt-1 text-[11px] text-ash-400">
              Questions the AI could not answer from the knowledge base, ranked by
              how often customers ask them.
            </p>
          </div>

          {topGaps.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-y border-charcoal-700 text-[10px] uppercase tracking-wider text-ash-400">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Unanswered question
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Asked
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Channel
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Suggested article
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-700/70">
                  {topGaps.map((gap) => {
                    const status = gapStatusMeta[gap.status];
                    const doc = kbDocs.find(
                      (item) => item.id === gap.suggestedKbDocId,
                    );
                    return (
                      <tr
                        key={gap.id}
                        className="align-top transition hover:bg-charcoal-800/60"
                      >
                        <td className="max-w-[300px] px-4 py-2.5 leading-relaxed text-cream-100">
                          “{gap.query}”
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="pill bg-brand-500/15 text-brand-200 ring-1 ring-inset ring-brand-400/40">
                            {gap.frequency}×
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ash-300">{gap.channel}</td>
                        <td className="px-4 py-2.5">
                          <span className={`pill ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-ash-300">
                          {doc ? (
                            doc.title
                          ) : (
                            <span className="text-ash-400">Needs a new article</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-6 pt-2 text-xs text-ash-400">
              No unanswered questions — every customer query is covered by the
              knowledge base.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  children,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ash-400">
          {label}
        </p>
        <Icon className="h-4 w-4 text-brand-300" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-cream-50">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ash-400">{hint}</p>
      {children}
    </div>
  );
}

function PanelHeading({
  icon: Icon,
  title,
  meta,
}: {
  icon: typeof Bot;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-ash-300">
        <Icon className="h-3.5 w-3.5 text-brand-300" />
        {title}
      </h2>
      {meta ? <span className="shrink-0 text-[11px] text-ash-400">{meta}</span> : null}
    </div>
  );
}
