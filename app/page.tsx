"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Clock,
  IndianRupee,
  Inbox,
  LifeBuoy,
  MessageSquareQuote,
  Package,
  RotateCcw,
  Sparkles,
  TrendingUp,
  UserRound,
  Wand2,
} from "lucide-react";
import AnalyticsView from "@/components/analytics/AnalyticsView";
import KnowledgeBaseView from "@/components/kb/KnowledgeBaseView";
import { useDeskStore } from "@/lib/store";
import type {
  KnowledgeGapStatus,
  OrderStatus,
  Ticket,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
});

const ticketStatusMeta: Record<
  TicketStatus,
  { label: string; className: string; icon: typeof Bot }
> = {
  ai_handling: {
    label: "AI handling",
    className: "bg-cream-200 text-charcoal-900",
    icon: Bot,
  },
  escalated: {
    label: "Escalated",
    className: "bg-brand-500 text-cream-100",
    icon: AlertTriangle,
  },
  human_takeover: {
    label: "Human takeover",
    className: "bg-brand-500/20 text-brand-200 ring-1 ring-inset ring-brand-400/40",
    icon: UserRound,
  },
  resolved: {
    label: "Resolved",
    className: "bg-charcoal-700 text-ash-300 ring-1 ring-inset ring-charcoal-600",
    icon: Sparkles,
  },
};

const priorityMeta: Record<TicketPriority, string> = {
  urgent: "bg-brand-500 text-cream-50",
  high: "bg-brand-500/25 text-brand-200 ring-1 ring-inset ring-brand-400/40",
  medium: "bg-cream-500/10 text-cream-300 ring-1 ring-inset ring-cream-200/20",
  low: "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
};

const orderStatusMeta: Record<OrderStatus, string> = {
  Processing: "bg-cream-500/10 text-cream-300 ring-1 ring-inset ring-cream-200/20",
  "In Transit": "bg-brand-500/20 text-brand-200 ring-1 ring-inset ring-brand-400/40",
  Delivered: "bg-cream-200 text-charcoal-900",
  Damaged: "bg-brand-500 text-cream-50",
  Cancelled: "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
};

const gapStatusMeta: Record<KnowledgeGapStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-brand-500 text-cream-50" },
  in_review: {
    label: "In review",
    className: "bg-cream-200 text-charcoal-900",
  },
  resolved: {
    label: "Resolved",
    className: "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
  },
};

function lastCustomerFacingMessage(ticket: Ticket) {
  return [...ticket.messages]
    .reverse()
    .find((message) => message.sender !== "system");
}

export default function DeskOverviewPage() {
  const [tab, setTab] = useState<"inbox" | "kb" | "analytics">("inbox");
  const {
    tickets,
    orders,
    kbDocs,
    knowledgeGaps,
    hydrated,
    resetStore,
  } = useDeskStore();

  const stats = useMemo(() => {
    const open = tickets.filter((t) => t.status !== "resolved").length;
    const escalations = tickets.filter((t) => t.status === "escalated").length;
    const citations = kbDocs.reduce((sum, doc) => sum + doc.citationCount, 0);
    const revenue = orders
      .filter((o) => o.status !== "Cancelled")
      .reduce((sum, o) => sum + o.amount, 0);
    return { open, escalations, citations, revenue };
  }, [tickets, kbDocs, orders]);

  const gaps = [...knowledgeGaps].sort((a, b) => b.frequency - a.frequency);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500 text-cream-100 shadow-glow">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-cream-50">
              DeskPilot
            </h1>
            <p className="text-sm text-ash-400">
              AI support desk for Indian D2C brands · Sunday, 15 Nov 2026
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={resetStore}
          className="focus-ring inline-flex items-center gap-2 self-start rounded-full border border-charcoal-600 bg-charcoal-800 px-3.5 py-2 text-xs font-medium text-cream-100 transition hover:border-brand-400 hover:text-cream-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset demo data
        </button>
      </header>

      <nav
        aria-label="Dashboard views"
        className="mt-6 inline-flex items-center gap-1 rounded-full border border-charcoal-600 bg-charcoal-800/80 p-1"
      >
        <button
          type="button"
          onClick={() => setTab("inbox")}
          aria-current={tab === "inbox" ? "page" : undefined}
          className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "inbox"
              ? "bg-cream-200 text-charcoal-900"
              : "text-ash-300 hover:bg-charcoal-700/70 hover:text-cream-100"
          }`}
        >
          <Inbox className="h-3.5 w-3.5" />
          Inbox
        </button>
        <button
          type="button"
          onClick={() => setTab("kb")}
          aria-current={tab === "kb" ? "page" : undefined}
          className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "kb"
              ? "bg-cream-200 text-charcoal-900"
              : "text-ash-300 hover:bg-charcoal-700/70 hover:text-cream-100"
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Knowledge base
        </button>
        <button
          type="button"
          onClick={() => setTab("analytics")}
          aria-current={tab === "analytics" ? "page" : undefined}
          className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
            tab === "analytics"
              ? "bg-cream-200 text-charcoal-900"
              : "text-ash-300 hover:bg-charcoal-700/70 hover:text-cream-100"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Analytics
        </button>
      </nav>

      {tab === "analytics" ? (
        <div className="mt-6">
          <AnalyticsView />
        </div>
      ) : tab === "kb" ? (
        <div className="mt-6">
          <KnowledgeBaseView />
        </div>
      ) : (
        <>
      <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={LifeBuoy}
          label="Open conversations"
          value={String(stats.open)}
          hint={`${tickets.length} total in inbox`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Escalations"
          value={String(stats.escalations)}
          hint="needs a human now"
          accent
        />
        <StatCard
          icon={TrendingUp}
          label="Policy citations"
          value={String(stats.citations)}
          hint={`${kbDocs.length} articles in KB`}
        />
        <StatCard
          icon={IndianRupee}
          label="Order value tracked"
          value={inr.format(stats.revenue)}
          hint={`${orders.length} orders loaded`}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="space-y-3">
          <SectionHeading
            icon={MessageSquareQuote}
            title="Support inbox"
            meta={`${tickets.filter((t) => t.status === "ai_handling").length} on autopilot`}
          />

          {tickets.map((ticket) => {
            const status = ticketStatusMeta[ticket.status];
            const StatusIcon = status.icon;
            const preview = lastCustomerFacingMessage(ticket);
            const citations = ticket.messages.reduce(
              (sum, message) => sum + (message.citations?.length ?? 0),
              0,
            );
            const actions = ticket.messages.reduce(
              (sum, message) => sum + (message.actions?.length ?? 0),
              0,
            );

            return (
              <article
                key={ticket.id}
                className="panel group p-4 transition hover:border-brand-400/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`pill ${status.className}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                  <span className={`pill uppercase tracking-wider ${priorityMeta[ticket.priority]}`}>
                    {ticket.priority}
                  </span>
                  <span className="text-[11px] font-medium text-ash-400">
                    {ticket.id}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ash-400">
                    <Clock className="h-3 w-3" />
                    SLA {dateFmt.format(new Date(ticket.slaDeadline))},{" "}
                    {timeFmt.format(new Date(ticket.slaDeadline))}
                  </span>
                </div>

                <h3 className="mt-2.5 text-sm font-semibold text-cream-50">
                  {ticket.subject}
                </h3>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ash-400">
                  <span className="text-ash-300">{ticket.customerName}</span>
                  <span aria-hidden>·</span>
                  <span>{ticket.channel}</span>
                  {ticket.orderId ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono text-cream-200/80">
                        {ticket.orderId}
                      </span>
                    </>
                  ) : null}
                  {ticket.assignedTo ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{ticket.assignedTo}</span>
                    </>
                  ) : null}
                </p>

                {preview ? (
                  <div className="mt-3 rounded-xl border border-charcoal-700 bg-charcoal-900/70 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ash-400">
                      {preview.sender === "customer" ? (
                        <UserRound className="h-3 w-3" />
                      ) : (
                        <Bot className="h-3 w-3 text-cream-200" />
                      )}
                      {preview.senderName ?? preview.sender}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-cream-100/85">
                      {preview.text}
                    </p>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-ash-400">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    {citations} citation{citations === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Wand2 className="h-3 w-3" />
                    {actions} actions
                  </span>
                  {citations === 0 && actions === 0 ? (
                    <span className="text-ash-400/70">No AI trace yet</span>
                  ) : null}
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {ticket.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-charcoal-700/70 px-2 py-0.5 text-[10px] text-ash-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <div className="space-y-6">
          <section>
            <SectionHeading
              icon={Package}
              title="Live orders"
              meta={`${inr.format(stats.revenue)} GMV`}
            />
            <div className="panel divide-y divide-charcoal-700/70">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-xs font-medium text-cream-100">
                      <span className="font-mono text-ash-400">{order.id}</span>
                      <span className="truncate">{order.customerName}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-ash-400">
                      {order.items.map((item) => item.name).join(", ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-cream-50">
                      {inr.format(order.amount)}
                    </p>
                    <span className={`pill mt-1 ${orderStatusMeta[order.status]}`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading
              icon={AlertTriangle}
              title="Knowledge gaps"
              meta={`${gaps.length} logged`}
            />
            <div className="space-y-2.5">
              {gaps.map((gap) => {
                const meta = gapStatusMeta[gap.status];
                return (
                  <article key={gap.id} className="panel p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs leading-relaxed text-cream-100">
                        “{gap.query}”
                      </p>
                      <span className={`pill shrink-0 ${meta.className}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-ash-400">
                      Asked {gap.frequency}× · {gap.channel} · last{" "}
                      {dateFmt.format(new Date(gap.lastSeenAt))}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <SectionHeading
              icon={BookOpen}
              title="Knowledge base"
              meta="4 policies"
            />
            <div className="panel divide-y divide-charcoal-700/70">
              {kbDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-cream-100">
                      {doc.title}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-ash-400">
                      {doc.category} · {doc.version}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-cream-200/10 px-2 py-0.5 text-[10px] text-cream-200">
                    {doc.citationCount} cites
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <p className="mt-8 text-center text-[11px] text-ash-400">
        {hydrated
          ? "Demo data is stored in localStorage · reset anytime"
          : "Loading local workspace…"}
      </p>
        </>
      )}
    </main>
  );
}

function SectionHeading({
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
      {meta ? <span className="text-[11px] text-ash-400">{meta}</span> : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = false,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`panel p-4 ${accent ? "border-brand-400/40 bg-brand-900/30" : ""}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ash-400">
          {label}
        </p>
        <Icon
          className={`h-4 w-4 ${accent ? "text-cream-200" : "text-brand-300"}`}
        />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-cream-50">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ash-400">{hint}</p>
    </div>
  );
}
