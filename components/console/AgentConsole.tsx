"use client";

// DeskPilot live agent console.
//
// Three columns: SLA ticket queue, live conversation, customer context + AI
// co-pilot. All reads/writes go through useDeskStore so the queue, thread and
// local persistence stay in one place.
//
// Money rules are enforced in code here (GUARDRAIL_REFUND_LIMIT), never only in
// the model's prompt: anything above the ceiling can only move with an explicit
// human click on "Approve Guardrail Refund".

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock,
  Globe,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { useDeskStore } from "@/lib/store";
import { newActionLog } from "@/lib/log";
import type {
  ActionLog,
  Citation,
  Order,
  Ticket,
  TicketCategory,
  TicketChannel,
  TicketMessage,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Constants & formatting                                                     */
/* -------------------------------------------------------------------------- */

/** Hardcoded financial ceiling. Refunds at or below this may auto-execute. */
const GUARDRAIL_REFUND_LIMIT = 1000;

const AGENT_NAME = "Support Agent";
const AI_NAME = "DeskPilot AI";

const FIVE_MINUTES = 5 * 60 * 1000;

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

const statusMeta: Record<
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
    className: "bg-brand-500 text-cream-50",
    icon: AlertTriangle,
  },
  human_takeover: {
    label: "Human takeover",
    className:
      "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/40",
    icon: UserRound,
  },
  resolved: {
    label: "Resolved",
    className: "bg-charcoal-700 text-ash-300 ring-1 ring-inset ring-charcoal-600",
    icon: CheckCircle2,
  },
};

const priorityMeta: Record<TicketPriority, string> = {
  urgent: "bg-brand-500 text-cream-50",
  high: "bg-brand-500/25 text-brand-200 ring-1 ring-inset ring-brand-400/40",
  medium: "bg-cream-500/10 text-cream-300 ring-1 ring-inset ring-cream-200/20",
  low: "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
};

const channelMeta: Record<
  TicketChannel,
  { label: string; icon: typeof Bot; className: string }
> = {
  WhatsApp: {
    label: "WhatsApp",
    icon: MessageCircle,
    className: "text-emerald-300",
  },
  "Instagram DM": {
    label: "Instagram",
    icon: Instagram,
    className: "text-pink-300",
  },
  "Web Chat": { label: "Web Chat", icon: Globe, className: "text-sky-300" },
  Email: { label: "Email", icon: Mail, className: "text-cream-200" },
};

const actionIconMeta: Record<ActionLog["type"], typeof Bot> = {
  knowledge_lookup: BookOpen,
  order_lookup: Package,
  draft: Wand2,
  tool_call: Wand2,
  escalation: AlertTriangle,
  assignment: UserRound,
  resolution: CheckCircle2,
  system: Activity,
};

const REFUND_CATEGORIES: TicketCategory[] = [
  "Refund",
  "Damaged Product",
  "Payments",
];

type QueueFilter = "all" | "ai_handling" | "needs_human";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "2h 14m" past the hour, or "04:23" inside the final hour. */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Retrieval confidence shown on the citation pill. RAG payloads carry a real
 * `matchScore`; seeded demo citations fall back to a stable value derived from
 * the chunk, so the same passage always reports the same score.
 */
function citationMatchScore(citation: Citation): number {
  if (typeof citation.matchScore === "number") {
    return Math.max(0, Math.min(100, Math.round(citation.matchScore)));
  }

  let hash = 0;
  const seed = `${citation.docId}:${citation.snippet}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return 82 + (hash % 16);
}

/** Deterministic co-pilot draft — no model call, always grounded in the order. */
function buildSuggestedReply(ticket: Ticket, order?: Order): string {
  const name = firstName(ticket.customerName);

  if (
    order &&
    order.amount > GUARDRAIL_REFUND_LIMIT &&
    REFUND_CATEGORIES.includes(ticket.category)
  ) {
    return `${name} ji, order ${order.id} (${inr.format(order.amount)}) verify kar liya hai. Yeh amount ${inr.format(GUARDRAIL_REFUND_LIMIT)} ke auto-refund limit se zyada hai, isliye manager approval chahiye — maine ise urgent flag kar diya hai aur approve hote hi aapko isi thread par confirmation milega.`;
  }

  if (order && order.status === "Damaged") {
    return `${name} ji, damage ke liye sorry 🙏 Order ${order.id} ke photos mil gaye hain. Full refund ${inr.format(order.amount)} original payment method par 5–7 working days mein credit hoga. Reverse pickup free hai.`;
  }

  if (order && order.status === "In Transit") {
    return `${name} ji, aapka order ${order.id} ${order.carrier ?? "courier partner"} ke saath transit mein hai (AWB ${order.awb ?? "pending"}). Tracking link scan ke baad 6 ghante tak refresh hone mein time leta hai, isliye status purana lag sakta hai. Promised date tak update na aaye to main priority trace aur ${inr.format(100)} shipping credit raise kar dunga.`;
  }

  switch (ticket.category) {
    case "Payments":
      return `${name} ji, debited amount bank ya UPI PSP 48 ghante mein auto-reverse karta hai. Dobara payment retry mat kijiye — duplicate order ban sakta hai. Main aapka reference number reconciliation team ko de raha hoon.`;
    case "Warranty":
      return `${name} ji, yeh issue warranty mein cover hota hai. Ek close-up photo ya 10-second video share kar dijiye, main replacement raise kar deta hoon — approval ke baad 3 working days mein ship hoga.`;
    case "Refund":
      return `${name} ji, refund request receive ho gayi hai. Approved refunds original payment method par 5–7 working days mein, ya store credit 24 ghante mein credit hota hai. Main status update isi thread par bhejta rahunga.`;
    case "Order Tracking":
      return `${name} ji, maine latest shipment scan pull kar liya hai. Parcel expected date tak pahunch jayega — koi exception nahi dikh raha. Main is ticket par next scan aate hi update kar dunga.`;
    default:
      return `${name} ji, details ke liye thanks. Main abhi check kar raha hoon aur next step isi thread par confirm kar dunga.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function SlaCountdown({
  deadline,
  now,
}: {
  deadline: string;
  now: number | null;
}) {
  if (now === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-charcoal-700/70 px-2 py-0.5 text-[10px] text-ash-400">
        <Clock className="h-3 w-3" />
        SLA --:--
      </span>
    );
  }

  const remaining = new Date(deadline).getTime() - now;

  if (remaining <= 0) {
    return (
      <span className="inline-flex animate-pulse items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-300 ring-1 ring-inset ring-red-400/50">
        <AlertTriangle className="h-3 w-3" />
        SLA breached {formatRemaining(remaining)} ago
      </span>
    );
  }

  const urgent = remaining <= FIVE_MINUTES;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${
        urgent
          ? "animate-pulse bg-amber-400/15 text-amber-300 ring-1 ring-inset ring-amber-400/50"
          : "bg-charcoal-700/70 text-ash-300"
      }`}
    >
      <Clock className="h-3 w-3" />
      SLA {formatRemaining(remaining)}
    </span>
  );
}

function ActionList({ actions }: { actions: ActionLog[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {actions.map((action) => {
        const Icon = actionIconMeta[action.type];
        return (
          <li
            key={action.id}
            className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ash-400"
          >
            <Icon className="mt-0.5 h-3 w-3 shrink-0 text-brand-300" />
            <span className="min-w-0">
              <span className="text-ash-300">{action.label}</span>
              {action.detail ? (
                <span className="text-ash-400/80"> · {action.detail}</span>
              ) : null}
              <span className="ml-1 text-ash-400/60">
                {timeFmt.format(new Date(action.timestamp))}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MessageBubble({
  message,
  activeCitationKey,
  onOpenCitation,
}: {
  message: TicketMessage;
  activeCitationKey: string | null;
  onOpenCitation: (key: string, citation: Citation) => void;
}) {
  if (message.sender === "system") {
    return (
      <div className="mx-auto w-full max-w-[92%] rounded-lg border border-dashed border-charcoal-600 bg-charcoal-900/60 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ash-400">
          <Activity className="h-3 w-3" />
          System
          <span className="ml-auto font-normal normal-case tracking-normal text-ash-400/70">
            {timeFmt.format(new Date(message.timestamp))}
          </span>
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ash-300">
          {message.text}
        </p>
        {message.actions?.length ? <ActionList actions={message.actions} /> : null}
      </div>
    );
  }

  const isCustomer = message.sender === "customer";
  const isAgent = message.sender === "agent";

  const wrapper = isCustomer ? "items-start" : "items-end";
  const bubbleClass = isCustomer
    ? "rounded-2xl rounded-bl-md border border-charcoal-600 bg-charcoal-800"
    : isAgent
      ? "rounded-2xl rounded-br-md border border-emerald-400/35 bg-emerald-500/[0.08]"
      : "rounded-2xl rounded-br-md border border-indigo-400/35 bg-indigo-500/[0.08]";
  const labelClass = isCustomer
    ? "text-ash-300"
    : isAgent
      ? "text-emerald-300"
      : "text-indigo-300";
  const SenderIcon = isCustomer ? UserRound : isAgent ? UserRound : Bot;

  return (
    <div className={`flex flex-col ${wrapper}`}>
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px]">
        <SenderIcon className={`h-3 w-3 ${labelClass}`} />
        <span className={`font-medium ${labelClass}`}>
          {message.senderName ?? (isCustomer ? "Customer" : "Agent")}
        </span>
        <span className="text-ash-400/60">
          {timeFmt.format(new Date(message.timestamp))}
        </span>
        {message.internal ? (
          <span className="rounded-full bg-charcoal-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ash-400">
            internal
          </span>
        ) : null}
      </div>

      <div
        className={`max-w-[86%] border px-3 py-2 text-xs leading-relaxed text-cream-100 ${bubbleClass}`}
      >
        <p className="whitespace-pre-line">{message.text}</p>

        {message.citations?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation, index) => {
              const key = `${message.id}:${index}`;
              const active = activeCitationKey === key;
              const score = citationMatchScore(citation);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onOpenCitation(key, citation)}
                  aria-expanded={active}
                  aria-label={`Retrieved source: ${citation.title} ${citation.version}, ${score}% match`}
                  className={`focus-ring inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                    active
                      ? "border-[#F5E1BE]/70 bg-[#F5E1BE]/25 text-[#F5E1BE]"
                      : "border-[#F5E1BE]/25 bg-[#F5E1BE]/10 text-[#F5E1BE]/85 hover:border-[#F5E1BE]/60 hover:bg-[#F5E1BE]/20 hover:text-[#F5E1BE]"
                  }`}
                >
                  <span aria-hidden>📄</span>
                  <span className="truncate">
                    {citation.title} {citation.version}
                  </span>
                  <span aria-hidden className="opacity-55">
                    •
                  </span>
                  <span className="shrink-0 tabular-nums opacity-90">
                    {score}% match
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {message.actions?.length ? (
        <div className="max-w-[86%] px-1">
          <ActionList actions={message.actions} />
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-ash-400" />
      <div className="min-w-0">
        <p className="text-[9px] font-medium uppercase tracking-wider text-ash-400">
          {label}
        </p>
        <p className="truncate text-xs text-cream-100">{value}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Console                                                                    */
/* -------------------------------------------------------------------------- */

export default function AgentConsole() {
  const {
    tickets,
    orders,
    kbDocs,
    hydrated,
    addTicketMessage,
    updateTicket,
    updateTicketStatus,
  } = useDeskStore();

  // Live clock for the SLA timers. Null until mounted so SSR and the first
  // client render agree, then ticks once a second.
  const [now, setNow] = useState<number | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [activeCitation, setActiveCitation] = useState<{
    key: string;
    citation: Citation;
  } | null>(null);
  const [approvedOrderIds, setApprovedOrderIds] = useState<string[]>([]);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const counts = useMemo(
    () => ({
      all: tickets.length,
      ai_handling: tickets.filter((t) => t.status === "ai_handling").length,
      needs_human: tickets.filter(
        (t) => t.status === "escalated" || t.status === "human_takeover",
      ).length,
    }),
    [tickets],
  );

  const visibleTickets = useMemo(() => {
    const matches = (ticket: Ticket) => {
      if (filter === "ai_handling") return ticket.status === "ai_handling";
      if (filter === "needs_human") {
        return ticket.status === "escalated" || ticket.status === "human_takeover";
      }
      return true;
    };

    return tickets
      .filter(matches)
      .slice()
      .sort((a, b) => {
        const aResolved = a.status === "resolved";
        const bResolved = b.status === "resolved";
        if (aResolved !== bResolved) return aResolved ? 1 : -1;
        return (
          new Date(a.slaDeadline).getTime() - new Date(b.slaDeadline).getTime()
        );
      });
  }, [tickets, filter]);

  // The selected ticket survives filtering only while it stays visible.
  const activeTicket =
    visibleTickets.find((ticket) => ticket.id === selectedId) ??
    visibleTickets[0] ??
    tickets[0] ??
    null;
  const activeId = activeTicket?.id ?? null;

  const linkedOrders = useMemo(() => {
    if (!activeTicket) return [];
    return orders.filter(
      (order) =>
        order.id === activeTicket.orderId ||
        order.customerPhone === activeTicket.customerPhone,
    );
  }, [orders, activeTicket]);

  const primaryOrder = linkedOrders[0];

  /** >₹1,000 and still open: the AI is not allowed to move this money alone. */
  const guardrailOrder = useMemo(() => {
    if (!activeTicket || activeTicket.status === "resolved") return undefined;
    return linkedOrders
      .filter(
        (order) =>
          order.amount > GUARDRAIL_REFUND_LIMIT &&
          !approvedOrderIds.includes(order.id),
      )
      .sort((a, b) => b.amount - a.amount)[0];
  }, [activeTicket, linkedOrders, approvedOrderIds]);

  const recentlyApproved = linkedOrders.find((order) =>
    approvedOrderIds.includes(order.id),
  );

  const suggestedReply = activeTicket
    ? buildSuggestedReply(activeTicket, primaryOrder)
    : "";

  const canReply = activeTicket?.status === "human_takeover";

  // Switching tickets clears the per-ticket composer and citation panels.
  useEffect(() => {
    setDraft("");
    setActiveCitation(null);
  }, [activeId]);

  // Keep the newest message in view.
  const messageCount = activeTicket?.messages.length ?? 0;
  useEffect(() => {
    const node = feedRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeId, messageCount]);

  // Escape closes the retrieved-chunk drawer.
  useEffect(() => {
    if (!activeCitation) return;
    const handleKey = (event: { key: string }) => {
      if (event.key === "Escape") setActiveCitation(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeCitation]);

  if (!activeTicket) {
    return (
      <div className="panel flex min-h-[320px] items-center justify-center p-8 text-sm text-ash-400">
        {hydrated
          ? "No conversations in this view."
          : "Loading the support queue…"}
      </div>
    );
  }

  const activeStatus = statusMeta[activeTicket.status];
  const activeChannel = channelMeta[activeTicket.channel];

  function appendSystemNote(
    text: string,
    action: { label: string; detail: string; type: ActionLog["type"] },
  ) {
    if (!activeTicket) return;
    addTicketMessage(activeTicket.id, {
      sender: "system",
      text,
      actions: [newActionLog(action.type, action.label, action.detail)],
    });
  }

  function handleTakeOver() {
    if (!activeTicket) return;
    updateTicketStatus(activeTicket.id, "human_takeover");
    updateTicket(activeTicket.id, { assignedTo: AGENT_NAME });
    appendSystemNote(
      `${AGENT_NAME} joined the conversation. AI suggestions are paused until hand-back.`,
      {
        type: "assignment",
        label: "Human takeover",
        detail: `Assigned to ${AGENT_NAME} · AI paused`,
      },
    );
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function handleHandBack() {
    if (!activeTicket) return;
    updateTicketStatus(activeTicket.id, "ai_handling");
    updateTicket(activeTicket.id, { assignedTo: AI_NAME });
    appendSystemNote(
      `Conversation handed back to ${AI_NAME}. Policy-grounded suggestions resume.`,
      {
        type: "assignment",
        label: "Handed back to AI",
        detail: `${AI_NAME} · policy guardrails active`,
      },
    );
  }

  function handleSend() {
    if (!activeTicket || !canReply) return;
    const text = draft.trim();
    if (!text) return;
    addTicketMessage(activeTicket.id, {
      sender: "agent",
      senderName: AGENT_NAME,
      text,
    });
    setDraft("");
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSend();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleUseSuggested() {
    if (!activeTicket) return;
    setDraft(suggestedReply);
    composerRef.current?.focus();
  }

  function handleApproveRefund(order: Order) {
    if (!activeTicket) return;
    setApprovedOrderIds((prev) =>
      prev.includes(order.id) ? prev : [...prev, order.id],
    );
    addTicketMessage(activeTicket.id, {
      sender: "system",
      text: `Manager approval recorded: ${inr.format(order.amount)} refund on ${order.id} cleared by ${AGENT_NAME}. Refund will land on the original payment method in 5–7 working days.`,
      actions: [
        newActionLog(
          "tool_call",
          `Guardrail refund approved · ${inr.format(order.amount)}`,
          `${order.id} · above ${inr.format(GUARDRAIL_REFUND_LIMIT)} ceiling · manual approval`,
        ),
      ],
    });
  }

  const tabs: { id: QueueFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "ai_handling", label: "AI Handling", count: counts.ai_handling },
    { id: "needs_human", label: "Needs Human", count: counts.needs_human },
  ];

  // Full document behind the open citation, when it exists in the desk store.
  const citationDoc = activeCitation
    ? kbDocs.find((doc) => doc.id === activeCitation.citation.docId)
    : undefined;

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-6rem)] lg:grid-cols-[28fr_44fr_28fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Left: ticket queue                                               */}
      {/* ---------------------------------------------------------------- */}
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <header className="border-b border-charcoal-700 px-3.5 py-3">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ash-300">
              <MessageCircle className="h-3.5 w-3.5 text-brand-300" />
              Ticket queue
            </h1>
            <span className="text-[10px] text-ash-400">
              {visibleTickets.length} shown
            </span>
          </div>

          <div className="mt-2.5 flex gap-1 rounded-full border border-charcoal-700 bg-charcoal-900/70 p-1">
            {tabs.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  aria-pressed={active}
                  className={`focus-ring flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition ${
                    active
                      ? "bg-brand-500 text-cream-50"
                      : "text-ash-300 hover:bg-charcoal-800 hover:text-cream-100"
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                  <span
                    className={`rounded-full px-1 text-[9px] ${
                      active ? "bg-charcoal-900/30 text-cream-100" : "text-ash-400"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
          {visibleTickets.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-ash-400">
              Nothing here — switch tabs.
            </p>
          ) : null}

          {visibleTickets.map((ticket) => {
            const channel = channelMeta[ticket.channel];
            const ChannelIcon = channel.icon;
            const status = statusMeta[ticket.status];
            const isActive = ticket.id === activeTicket.id;

            return (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                aria-current={isActive}
                className={`focus-ring w-full rounded-xl border p-3 text-left transition ${
                  isActive
                    ? "border-brand-400/70 bg-charcoal-800 ring-1 ring-brand-400/25"
                    : "border-charcoal-700 bg-charcoal-850/60 hover:border-charcoal-600 hover:bg-charcoal-800/70"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/25 text-[9px] font-semibold text-cream-100">
                    {initials(ticket.customerName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-cream-50">
                    {ticket.customerName}
                  </span>
                  <span title={channel.label} aria-label={channel.label}>
                    <ChannelIcon className={`h-3.5 w-3.5 ${channel.className}`} />
                  </span>
                </div>

                <p className="mt-1.5 line-clamp-1 text-[11px] text-ash-300">
                  {ticket.subject}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="pill bg-charcoal-700 text-[10px] text-ash-300">
                    {ticket.category}
                  </span>
                  <span
                    className={`pill text-[10px] capitalize ${priorityMeta[ticket.priority]}`}
                  >
                    {ticket.priority}
                  </span>
                  <span className={`pill text-[10px] ${status.className}`}>
                    <status.icon className="h-2.5 w-2.5" />
                    {status.label}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <SlaCountdown deadline={ticket.slaDeadline} now={now} />
                  <span className="font-mono text-[9px] text-ash-400">
                    {ticket.id}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Center: live conversation                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative panel flex min-h-0 flex-col overflow-hidden">
        <header className="flex items-start gap-3 border-b border-charcoal-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-ash-400">
                {activeTicket.id}
              </span>
              <span className={`pill text-[10px] ${activeStatus.className}`}>
                <activeStatus.icon className="h-2.5 w-2.5" />
                {activeStatus.label}
              </span>
              <span className="pill bg-charcoal-700 text-[10px] capitalize text-ash-300">
                {activeTicket.priority} priority
              </span>
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold text-cream-50">
              {activeTicket.subject}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ash-400">
              <activeChannel.icon
                className={`h-3 w-3 ${activeChannel.className}`}
              />
              {activeTicket.customerName} · {activeChannel.label} ·{" "}
              {activeTicket.assignedTo ?? "Unassigned"}
            </p>
          </div>

          <button
            type="button"
            onClick={canReply ? handleHandBack : handleTakeOver}
            className={
              canReply
                ? "focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/60 px-3 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-400/10"
                : "focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 py-2 text-[11px] font-semibold text-charcoal-950 shadow-glow transition hover:bg-amber-300"
            }
          >
            {canReply ? (
              <>
                <Bot className="h-3.5 w-3.5" />
                Hand Back to AI
              </>
            ) : (
              <>
                <UserRound className="h-3.5 w-3.5" />
                Take Over Chat
              </>
            )}
          </button>
        </header>

        <div
          ref={feedRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {activeTicket.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              activeCitationKey={activeCitation?.key ?? null}
              onOpenCitation={(key, citation) =>
                setActiveCitation((current) =>
                  current?.key === key ? null : { key, citation },
                )
              }
            />
          ))}
        </div>

        <form
          onSubmit={handleFormSubmit}
          className="border-t border-charcoal-700 bg-charcoal-900/40 px-3.5 py-3"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={!canReply}
              rows={2}
              placeholder={
                canReply
                  ? `Reply as ${AGENT_NAME}…`
                  : "Take over the chat to reply manually"
              }
              className="focus-ring min-h-[46px] flex-1 resize-none rounded-xl border border-charcoal-700 bg-charcoal-900 px-3 py-2 text-xs leading-relaxed text-cream-100 placeholder:text-ash-400/70 transition focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!canReply || draft.trim().length === 0}
              className="focus-ring inline-flex h-[46px] shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 text-[11px] font-semibold text-cream-50 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:bg-charcoal-700 disabled:text-ash-400"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-ash-400">
            {canReply
              ? "Enter to send · Shift + Enter for a new line · replies are logged to the ticket"
              : "AI is handling this thread. Take over to type a manual reply."}
          </p>
        </form>

        {activeCitation ? (
          <div
            className="absolute inset-0 z-20"
            role="dialog"
            aria-label="Retrieved source chunk"
          >
            <button
              type="button"
              aria-label="Close retrieved chunk"
              onClick={() => setActiveCitation(null)}
              className="absolute inset-0 cursor-default bg-charcoal-950/60"
            />

            <div className="absolute inset-y-0 right-0 flex w-[min(360px,90%)] flex-col border-l border-charcoal-700 bg-charcoal-900/95 shadow-glow backdrop-blur">
              <header className="flex items-start gap-2 border-b border-charcoal-700 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-medium uppercase tracking-wider text-ash-400">
                    Retrieved chunk
                  </p>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-cream-50">
                    📄 {activeCitation.citation.title}{" "}
                    {activeCitation.citation.version}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ash-400">
                    <span className="font-semibold text-[#F5E1BE]">
                      {citationMatchScore(activeCitation.citation)}% match
                    </span>
                    {" · "}
                    <span className="font-mono">
                      {activeCitation.citation.docId}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCitation(null)}
                  aria-label="Close"
                  className="focus-ring rounded-full border border-charcoal-600 p-1 text-ash-300 transition hover:text-cream-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                <p className="text-[9px] font-medium uppercase tracking-wider text-ash-400">
                  Exact text retrieved from the knowledge base
                </p>
                <blockquote className="mt-1.5 rounded-lg border border-[#F5E1BE]/25 bg-[#F5E1BE]/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-cream-100">
                  “{activeCitation.citation.snippet}”
                </blockquote>
                {citationDoc ? (
                  <p className="mt-2 text-[10px] leading-relaxed text-ash-400">
                    {citationDoc.category} · {citationDoc.version} ·{" "}
                    {citationDoc.citationCount} citations so far
                  </p>
                ) : null}
              </div>

              <footer className="border-t border-charcoal-700 px-3.5 py-2 text-[10px] leading-relaxed text-ash-400">
                The reply above was generated only from this passage. Press Esc
                to close.
              </footer>
            </div>
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Right: customer context + co-pilot                               */}
      {/* ---------------------------------------------------------------- */}
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-0.5">
        <section className="panel shrink-0 p-4">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ash-300">
            <UserRound className="h-3.5 w-3.5 text-brand-300" />
            Customer
          </h2>

          <div className="mt-3 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/25 text-[11px] font-semibold text-cream-100">
              {initials(activeTicket.customerName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-cream-50">
                {activeTicket.customerName}
              </p>
              <p className="text-[11px] text-ash-400">
                {linkedOrders.length} order
                {linkedOrders.length === 1 ? "" : "s"} ·{" "}
                {activeTicket.tags[0] ? `#${activeTicket.tags[0]}` : "no tags"}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2.5">
            <DetailRow
              icon={Phone}
              label="Phone"
              value={activeTicket.customerPhone}
            />
            <DetailRow
              icon={activeChannel.icon}
              label="Channel"
              value={activeChannel.label}
            />
            <DetailRow
              icon={MapPin}
              label="City"
              value={primaryOrder?.customerCity ?? "Not on file"}
            />
            <DetailRow
              icon={Clock}
              label="SLA deadline"
              value={`${timeFmt.format(new Date(activeTicket.slaDeadline))} · ${activeTicket.id}`}
            />
          </div>
        </section>

        <section className="panel shrink-0 p-4">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ash-300">
            <Package className="h-3.5 w-3.5 text-brand-300" />
            Linked orders
            <span className="ml-auto normal-case tracking-normal text-[10px] text-ash-400">
              {linkedOrders.length}
            </span>
          </h2>

          <div className="mt-3 space-y-2">
            {linkedOrders.length === 0 ? (
              <p className="rounded-lg border border-dashed border-charcoal-600 px-3 py-3 text-[11px] text-ash-400">
                No order linked to this conversation. Ask for the order ID before
                quoting amounts.
              </p>
            ) : null}

            {linkedOrders.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-charcoal-700 bg-charcoal-900/60 p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11px] text-ash-300">
                    {order.id}
                  </span>
                  <span className="text-xs font-semibold text-cream-50">
                    {inr.format(order.amount)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-ash-400">
                  {order.items
                    .map((item) => `${item.name} ×${item.quantity}`)
                    .join(", ")}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="pill bg-charcoal-700 text-[9px] text-ash-300">
                    {order.status}
                  </span>
                  <span className="pill bg-charcoal-700/60 text-[9px] text-ash-400">
                    {order.paymentMethod}
                  </span>
                  {order.awb ? (
                    <span className="ml-auto font-mono text-[9px] text-ash-400">
                      {order.awb}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel shrink-0 border-brand-400/35 bg-brand-900/25 p-4 shadow-glow">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ash-300">
            <Sparkles className="h-3.5 w-3.5 text-cream-200" />
            AI Co-Pilot
            <span className="ml-auto rounded-full bg-cream-200/10 px-1.5 py-0.5 normal-case tracking-normal text-[9px] text-cream-200">
              policy-grounded
            </span>
          </h2>

          <p className="mt-3 text-[9px] font-medium uppercase tracking-wider text-ash-400">
            Suggested reply
          </p>
          <blockquote className="mt-1 rounded-lg border border-charcoal-700 bg-charcoal-900/70 px-2.5 py-2 text-[11px] leading-relaxed text-cream-100/90">
            {suggestedReply}
          </blockquote>

          <button
            type="button"
            onClick={handleUseSuggested}
            className="focus-ring mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cream-200 px-3 py-1.5 text-[11px] font-semibold text-charcoal-900 transition hover:bg-cream-100"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Use Suggested Reply
          </button>
          <p className="mt-1 text-[10px] text-ash-400">
            {canReply
              ? "Loads the draft into the reply box — edit before sending."
              : "Loads the draft into the reply box; take over the chat to send it."}
          </p>

          {guardrailOrder ? (
            <div className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 p-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-300">
                <ShieldAlert className="h-3 w-3" />
                Guardrail triggered
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-cream-100/85">
                {inr.format(guardrailOrder.amount)} refund on{" "}
                {guardrailOrder.id} is above the{" "}
                {inr.format(GUARDRAIL_REFUND_LIMIT)} auto-refund ceiling. The AI
                is blocked from executing it — a manager must approve.
              </p>
              <button
                type="button"
                onClick={() => handleApproveRefund(guardrailOrder)}
                className="focus-ring mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-semibold text-cream-50 transition hover:bg-red-400"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Approve Guardrail Refund
              </button>
              <p className="mt-1 text-[10px] text-red-200/70">
                Approval is logged to this ticket with the amount and order ID.
              </p>
            </div>
          ) : null}

          {recentlyApproved && !guardrailOrder ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              {inr.format(recentlyApproved.amount)} refund approved manually on{" "}
              {recentlyApproved.id}. Refund logged to the ticket.
            </p>
          ) : null}

          <p className="mt-3 border-t border-charcoal-700 pt-2 text-[10px] leading-relaxed text-ash-400">
            Hardcoded rule: refunds ≤ {inr.format(GUARDRAIL_REFUND_LIMIT)}{" "}
            auto-execute; anything above is blocked and escalated to a human.
          </p>
        </section>
      </aside>
    </div>
  );
}
