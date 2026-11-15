"use client";

import { useMemo } from "react";
import {
  ArrowDownRight,
  BookOpen,
  Bot,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
} from "lucide-react";
import { ANALYTICS_BASELINE } from "@/lib/analytics-baseline";
import { useDeskStore } from "@/lib/store";
import type {
  KnowledgeGapStatus,
  Order,
  Ticket,
  TicketCategory,
} from "@/lib/types";

const CATEGORY_ORDER: TicketCategory[] = [
  "Order Tracking",
  "Damaged Product",
  "Refund",
  "Payments",
  "Warranty",
  "Product Query",
  "Other",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Order Tracking": "#733015",
  "Damaged Product": "#B96B3D",
  Refund: "#F5E1BE",
  Payments: "#D4956E",
  Warranty: "#E6BCA0",
  "Product Query": "#9C8B7E",
  Other: "#4C3B30",
};

const gapStatusMeta: Record<
  KnowledgeGapStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-brand-500 text-cream-50" },
  in_review: { label: "In review", className: "bg-cream-200 text-charcoal-900" },
  resolved: {
    label: "Resolved",
    className: "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
  },
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
});

const aiContainedStatuses: Ticket["status"][] = ["resolved", "ai_handling"];

/** Round to one decimal only when the value is small enough to need it. */
function pct(value: number): string {
  return `${value >= 99.95 ? 100 : value.toFixed(value < 10 ? 1 : 0)}%`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function guardrailExposure(ticket: Ticket, orders: Order[]): number {
  if (ticket.status !== "escalated" && ticket.status !== "human_takeover") {
    return 0;
  }
  if (!["Refund", "Damaged Product", "Payments"].includes(ticket.category)) {
    return 0;
  }
  const order = orders.find((entry) => entry.id === ticket.orderId);
  if (!order || order.amount < 500) return 0;
  return order.amount;
}

export function AnalyticsView() {
  const { tickets, orders, knowledgeGaps } = useDeskStore();

  const metrics = useMemo(() => {
    const liveContained = tickets.filter((ticket) =>
      aiContainedStatuses.includes(ticket.status),
    ).length;

    const totalConversations = ANALYTICS_BASELINE.conversations + tickets.length;
    const containedTotal = ANALYTICS_BASELINE.aiContained + liveContained;
    const resolutionRate =
      totalConversations > 0 ? (containedTotal / totalConversations) * 100 : 0;

    const rated = tickets.filter(
      (ticket) => typeof ticket.satisfactionScore === "number",
    );
    const csatCount = ANALYTICS_BASELINE.csatCount + rated.length;
    const csat =
      (ANALYTICS_BASELINE.csatSum +
        rated.reduce((sum, ticket) => sum + (ticket.satisfactionScore ?? 0), 0)) /
      csatCount;
    // Newest live ticket that carries a score, so the caption follows the data.
    const latestRated = [...rated].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    const humanSeconds = ANALYTICS_BASELINE.avgHumanSeconds;
    const fasterPercent =
      (1 - ANALYTICS_BASELINE.avgAiSeconds / humanSeconds) * 100;

    const liveGuardrailCases = tickets
      .map((ticket) => guardrailExposure(ticket, orders))
      .filter((amount) => amount > 0);
    const guardrailTotal =
      ANALYTICS_BASELINE.guardrailSavedInr +
      liveGuardrailCases.reduce((sum, amount) => sum + amount, 0);

    return {
      resolutionRate,
      containedTotal,
      totalConversations,
      liveContained,
      csat,
      csatCount,
      liveRatedCount: rated.length,
      latestRatedScore: latestRated?.satisfactionScore ?? null,
      latestRatedCustomer: latestRated?.customerName ?? null,
      aiSeconds: ANALYTICS_BASELINE.avgAiSeconds,
      humanSeconds,
      fasterPercent,
      guardrailTotal,
      guardrailCases:
        ANALYTICS_BASELINE.guardrailCases + liveGuardrailCases.length,
      liveGuardrailCount: liveGuardrailCases.length,
    };
  }, [tickets, orders]);

  const categoryData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of tickets) {
      counts.set(ticket.category, (counts.get(ticket.category) ?? 0) + 1);
    }
    const known = CATEGORY_ORDER.filter((category) => counts.has(category));
    const extras = [...counts.keys()].filter(
      (category) => !CATEGORY_ORDER.includes(category as TicketCategory),
    );
    return [...known, ...extras]
      .map((category) => ({
        category,
        count: counts.get(category) ?? 0,
        color: CATEGORY_COLORS[category] ?? "#4C3B30",
      }))
      .sort((a, b) => b.count - a.count);
  }, [tickets]);

  const funnel = useMemo(() => {
    const received = tickets.length;
    const aiResponded = tickets.filter((ticket) =>
      ticket.messages.some((message) => message.sender === "ai"),
    ).length;
    const contained = tickets.filter((ticket) =>
      aiContainedStatuses.includes(ticket.status),
    ).length;
    const closed = tickets.filter((ticket) => ticket.status === "resolved").length;

    return [
      { label: "Conversations", value: received, hint: "in the last 30 days" },
      { label: "AI first response", value: aiResponded, hint: "replied by DeskPilot" },
      { label: "AI contained", value: contained, hint: "no human needed" },
      { label: "Closed", value: closed, hint: "outcome marked resolved" },
    ].map((stage, index, all) => {
      const base = all[0].value || 1;
      const previous = index === 0 ? base : all[index - 1].value;
      return {
        ...stage,
        width: Math.max(stage.value > 0 ? 8 : 0, (stage.value / base) * 100),
        conversion: previous > 0 ? (stage.value / previous) * 100 : 0,
      };
    });
  }, [tickets]);

  const openGaps = useMemo(
    () =>
      knowledgeGaps
        .filter((gap) => gap.status !== "resolved")
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 5),
    [knowledgeGaps],
  );

  const ratingStars = Math.round(metrics.csat);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-cream-50">
            <Sparkles className="h-4 w-4 text-brand-300" />
            Analytics
          </h1>
          <p className="mt-1 text-sm text-ash-400">
            Live from your support workspace · rolling 30 days
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-charcoal-600 bg-charcoal-800 px-3 py-1 text-[11px] font-medium text-cream-100">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cream-200 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cream-200" />
          </span>
          Live
        </span>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ash-400">
              AI resolution rate
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200">
              <Bot className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-cream-50">
            {pct(metrics.resolutionRate)}
          </p>
          <div className="relative mt-3">
            <div
              role="progressbar"
              aria-label="AI resolution rate"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(metrics.resolutionRate)}
              aria-valuetext={pct(metrics.resolutionRate)}
              className="h-2 w-full overflow-hidden rounded-full bg-brand-900"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#733015] via-[#B96B3D] to-[#F5E1BE] transition-[width] duration-500 ease-out"
                style={{ width: `${Math.min(100, metrics.resolutionRate)}%` }}
              />
            </div>
            <span
              aria-hidden
              className="absolute -top-0.5 h-3 border-l border-dashed border-cream-200/40"
              style={{ left: "71%" }}
            />
          </div>
          <p className="mt-2 text-[11px] text-ash-400">
            {metrics.containedTotal} of{" "}
            {metrics.totalConversations.toLocaleString("en-IN")} conversations
            handled without a human
          </p>
          <p className="mt-0.5 text-[10px] text-ash-400/70">
            {metrics.liveContained} live · {ANALYTICS_BASELINE.aiContained}{" "}
            from the 30-day baseline
          </p>
        </article>

        <article className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ash-400">
              CSAT score
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cream-200/10 text-cream-200">
              <Star className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 flex items-baseline gap-1 text-3xl font-semibold tracking-tight text-cream-50">
            {metrics.csat.toFixed(1)}
            <span className="text-sm font-normal text-ash-400">/ 5.0</span>
          </p>
          <div
            className="mt-3 flex items-center gap-1"
            aria-label={`${metrics.csat.toFixed(1)} out of 5 stars`}
          >
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={`h-3.5 w-3.5 ${
                  index < ratingStars
                    ? "fill-cream-200 text-cream-200"
                    : "text-charcoal-600"
                }`}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ash-400">
            {metrics.csatCount} ratings · {metrics.liveRatedCount} live
          </p>
          <p className="mt-0.5 text-[10px] text-ash-400/70">
            {metrics.latestRatedScore !== null
              ? `Latest live rating: ${metrics.latestRatedScore}/5 · ${metrics.latestRatedCustomer}`
              : "No live ratings yet"}
          </p>
        </article>

        <article className="panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ash-400">
              Avg AI response
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200">
              <Timer className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 flex items-baseline gap-1.5 text-3xl font-semibold tracking-tight text-cream-50">
            {metrics.aiSeconds.toFixed(1)}
            <span className="text-sm font-normal text-ash-400">s</span>
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ash-400">
            <ArrowDownRight className="h-3.5 w-3.5 text-cream-200" />
            <span className="font-medium text-cream-200">
              {metrics.fasterPercent.toFixed(1)}% faster
            </span>
            than {formatDuration(metrics.humanSeconds)} for human agents
          </p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full">
            <div
              className="bg-gradient-to-r from-[#733015] to-[#F5E1BE]"
              style={{ width: `${Math.max(1, 100 - metrics.fasterPercent)}%` }}
            />
            <div className="bg-charcoal-700" style={{ flex: 1 }} />
          </div>
        </article>

        <article className="panel border-brand-400/40 bg-brand-900/25 p-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ash-300">
              Guardrail savings
            </p>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cream-200/10 text-cream-200">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-cream-50">
            {inr.format(metrics.guardrailTotal)}
          </p>
          <p className="mt-3 text-[11px] text-ash-300">
            {metrics.guardrailCases} refunds above ₹500 held for human approval
            before payout
          </p>
          <p className="mt-0.5 text-[10px] text-ash-300/70">
            {metrics.liveGuardrailCount} live · {ANALYTICS_BASELINE.guardrailCases}{" "}
            from the 30-day baseline
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cream-200/10 px-2.5 py-1 text-[10px] font-medium text-cream-100">
            <ShieldCheck className="h-3 w-3" />
            Guardrail holds refunds above ₹500
          </div>
        </article>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-cream-50">
              Ticket volume by category
            </h2>
            <span className="text-[11px] text-ash-400">
              {tickets.length} conversation{tickets.length === 1 ? "" : "s"}
            </span>
          </div>

          {categoryData.length === 0 ? (
            <EmptyState label="No tickets yet — categories appear as chats arrive." />
          ) : (
            <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
              <CategoryDonut
                data={categoryData}
                total={categoryData.reduce((sum, entry) => sum + entry.count, 0)}
              />
              <ul className="w-full flex-1 space-y-2.5">
                {categoryData.map((entry) => {
                  const total = categoryData.reduce(
                    (sum, item) => sum + item.count,
                    0,
                  );
                  const share = total ? (entry.count / total) * 100 : 0;
                  return (
                    <li key={entry.category} className="flex items-center gap-2.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-cream-100/85">
                        {entry.category}
                      </span>
                      <span className="text-xs font-medium tabular-nums text-cream-50">
                        {entry.count}
                      </span>
                      <span className="w-9 text-right text-[11px] tabular-nums text-ash-400">
                        {share.toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </article>

        <article className="panel p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-cream-50">
              Resolution funnel
            </h2>
            <span className="text-[11px] text-ash-400">current inbox</span>
          </div>

          {tickets.length === 0 ? (
            <EmptyState label="No conversations to funnel yet." />
          ) : (
            <div className="mt-5 space-y-4">
              {funnel.map((stage) => (
                <div key={stage.label}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-medium text-ash-300">
                      {stage.label}
                    </p>
                    <p className="text-[11px] tabular-nums text-ash-400">
                      {stage.value}
                      <span className="ml-1.5 text-ash-400/70">
                        {stage.conversion.toFixed(0)}%
                      </span>
                    </p>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-charcoal-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#733015] to-[#D4956E] transition-[width] duration-500 ease-out"
                      style={{ width: `${stage.width}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-ash-400/80">{stage.hint}</p>
                </div>
              ))}
              <p className="border-t border-charcoal-700 pt-3 text-[10px] text-ash-400">
                AI containment: tickets answered and closed without a human
                takeover.
              </p>
            </div>
          )}
        </article>
      </div>

      {/* Knowledge gaps */}
      <article className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-cream-50">
              <BookOpen className="h-4 w-4 text-brand-300" />
              Knowledge gaps needing documentation
            </h2>
            <p className="mt-0.5 text-[11px] text-ash-400">
              Unanswered customer questions logged by the AI, ranked by frequency.
            </p>
          </div>
          <span className="rounded-full bg-cream-200/10 px-2.5 py-1 text-[11px] text-cream-200">
            {openGaps.length} open
          </span>
        </div>

        {openGaps.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState label="Every asked question is documented. Nice." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-y border-charcoal-700/80 text-[10px] uppercase tracking-wider text-ash-400">
                  <th scope="col" className="px-5 py-2 font-medium">
                    Question
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Asked
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                    Channel
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-700/60">
                {openGaps.map((gap) => (
                  <tr key={gap.id} className="transition hover:bg-charcoal-800/60">
                    <td className="max-w-[22rem] px-5 py-3">
                      <p className="truncate text-cream-100">“{gap.query}”</p>
                      {gap.suggestedKbDocId ? (
                        <p className="mt-0.5 text-[10px] text-ash-400">
                          Suggested update:{" "}
                          {gap.suggestedKbDocId.replace(/^kb-/, "").replace(/-/g, " ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-brand-200">
                        {gap.frequency}×
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`pill ${gapStatusMeta[gap.status].className}`}>
                        {gapStatusMeta[gap.status].label}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 text-ash-300 sm:table-cell">
                      {gap.channel}
                    </td>
                    <td className="px-5 py-3 text-right text-[11px] text-ash-400">
                      {dateFmt.format(new Date(gap.lastSeenAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function CategoryDonut({
  data,
  total,
}: {
  data: { category: string; count: number; color: string }[];
  total: number;
}) {
  const radius = 52;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  const gap = 4;

  let offset = 0;
  const segments = data.map((entry) => {
    const fraction = total ? entry.count / total : 0;
    const length = Math.max(0, fraction * circumference - gap);
    const segment = {
      ...entry,
      length,
      offset,
      share: fraction * 100,
    };
    offset += fraction * circumference;
    return segment;
  });

  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img">
        <title>Ticket volume by category</title>
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="#2A211B"
          strokeWidth={stroke}
        />
        {segments.map((segment) => (
          <circle
            key={segment.category}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${segment.length} ${circumference - segment.length}`}
            strokeDashoffset={-segment.offset}
          >
            <title>{`${segment.category}: ${segment.count} (${segment.share.toFixed(0)}%)`}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tracking-tight text-cream-50">
          {total}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ash-400">
          tickets
        </span>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center rounded-xl border border-dashed border-charcoal-600 px-4 py-10 text-center text-[11px] text-ash-400">
      {label}
    </div>
  );
}

export default AnalyticsView;
