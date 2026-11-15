"use client";

// Floating customer-side chat used to demo DeskPilot end to end on one screen.
//
// Every message is mirrored into the real ticket through useDeskStore, so the
// agent console reacts live. The LLM assistant at /api/chat answers when it is
// configured; without an OPENAI_API_KEY it returns 503 and we fall back to the
// deterministic policy router at /api/chat/simulate, so the demo always runs.
//
// Money never moves on model output: a refund tool call is executed through
// /api/actions, where the ₹1,000 ceiling lives in code.

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useDeskStore } from "@/lib/store";
import { newActionLog } from "@/lib/log";
import type { ChatReplyPayload, RefundResult } from "@/lib/actions";
import type {
  ActionLog,
  Citation,
  KbDoc,
  NewActionLog,
  Order,
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@/lib/types";

interface Persona {
  id: string;
  label: string;
  orderId: string | null;
}

const PERSONAS: Persona[] = [
  { id: "aarav", label: "Aarav (ORD-101 - ₹499)", orderId: "ORD-101" },
  { id: "priya", label: "Priya (ORD-102 - ₹2,499)", orderId: "ORD-102" },
  { id: "guest", label: "New Guest User", orderId: null },
];

const QUICK_PROMPTS = [
  "Bhai mera order ORD-103 damaged aaya hai, refund chahiye",
  "Need a refund for ORD-102 immediately",
  "What is your return window for electronics?",
  "Do you deliver to Port Blair?",
];

const ORDER_ID_RE = /ORD[\s-]*\d{2,6}/i;
const CITATION_RE = /^(.*?)\s*\((v[0-9][0-9.]*)\)\s*$/i;

interface SimMessage {
  id: string;
  role: "customer" | "ai" | "system";
  text: string;
  citations?: Citation[];
}

/** One normalised assistant turn, whichever backend produced it. */
interface SimTurn {
  reply: string;
  citations: Citation[];
  actions: NewActionLog[];
  knowledgeGap: boolean;
  escalate: boolean;
  priority?: TicketPriority;
  category?: TicketCategory;
  /** Order id the assistant wants refunded; executed via /api/actions. */
  refundOrderId: string | null;
  usedFallback?: boolean;
}

interface LlmChatResponse {
  reply: string;
  citation: string | null;
  isKnowledgeGap: boolean;
  escalate: boolean;
  category: TicketCategory;
  priority: TicketPriority;
  suggestedAgentReply: string;
  toolCall?: { name: string; arguments?: Record<string, unknown> } | null;
}

let simSequence = 0;
function nextId(): string {
  simSequence += 1;
  return `sim-${simSequence}`;
}

/** Route a message to the ticket that mentions its order, else the persona's. */
function resolveTicket(
  text: string,
  personaOrderId: string | null,
  tickets: Ticket[],
): Ticket | null {
  const mentioned = ORDER_ID_RE.exec(text)?.[0]?.replace(/\s+/g, "-").toUpperCase();
  const candidates = [mentioned, personaOrderId].filter(Boolean) as string[];

  for (const orderId of candidates) {
    const match = tickets.find(
      (ticket) => ticket.orderId?.toUpperCase() === orderId,
    );
    if (match) return match;
  }

  return tickets.find((ticket) => ticket.status !== "resolved") ?? tickets[0] ?? null;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as T;

  // api/actions answers 404 for an unknown order — that is a valid outcome the
  // caller renders, not a transport failure.
  if (!response.ok && response.status !== 404) {
    throw new Error(`${url} failed with ${response.status}`);
  }

  return payload;
}

function extractSnippet(content: string, max = 180): string {
  const end = content.indexOf(". ");
  const sentence = end === -1 ? content : content.slice(0, end + 1);
  const trimmed = sentence.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed;
}

/** Map the LLM's "Document Title (v1.2)" citation onto a real KB document. */
function resolveCitation(raw: string | null, kbDocs: KbDoc[]): Citation | null {
  if (!raw) return null;

  const match = CITATION_RE.exec(raw.trim());
  const title = (match?.[1] ?? raw).replace(/[()]/g, "").trim();
  const doc = kbDocs.find(
    (candidate) => candidate.title.toLowerCase() === title.toLowerCase(),
  );

  if (!doc) return null;

  return {
    docId: doc.id,
    title: doc.title,
    version: doc.version,
    snippet: extractSnippet(doc.content),
  };
}

function toolLogType(name: string): ActionLog["type"] {
  if (name === "escalate_to_human") return "escalation";
  if (name === "lookup_order") return "order_lookup";
  if (name === "create_refund_request") return "tool_call";
  return "system";
}

function mapLlmTurn(payload: LlmChatResponse, kbDocs: KbDoc[]): SimTurn {
  const citation = resolveCitation(payload.citation, kbDocs);
  const actions: NewActionLog[] = [];

  if (citation) {
    actions.push({
      type: "knowledge_lookup",
      label: `Cited ${citation.title} ${citation.version}`,
      detail: "Grounded in the supplied knowledge base",
    });
  }

  if (payload.toolCall) {
    const args = payload.toolCall.arguments
      ? JSON.stringify(payload.toolCall.arguments)
      : "no arguments";
    actions.push({
      type: toolLogType(payload.toolCall.name),
      label: `Tool call · ${payload.toolCall.name}`,
      detail: args.length > 120 ? `${args.slice(0, 120)}…` : args,
    });
  }

  if (payload.escalate) {
    actions.push({
      type: "escalation",
      label: "Escalated to a human agent",
      detail: `${payload.category} · priority ${payload.priority}`,
    });
  }

  const refundOrderId =
    payload.toolCall?.name === "create_refund_request" &&
    typeof payload.toolCall.arguments?.orderId === "string"
      ? payload.toolCall.arguments.orderId
      : null;

  return {
    reply: payload.reply,
    citations: citation ? [citation] : [],
    actions,
    knowledgeGap: payload.isKnowledgeGap,
    escalate: payload.escalate,
    priority: payload.priority,
    category: payload.category,
    refundOrderId,
  };
}

function mapSimTurn(payload: ChatReplyPayload): SimTurn {
  return {
    reply: payload.reply,
    citations: payload.citations,
    actions: payload.actions,
    knowledgeGap: payload.knowledgeGap,
    escalate: false,
    refundOrderId: payload.toolCall?.orderId ?? null,
    usedFallback: true,
  };
}

/** Ask the LLM assistant first; degrade to the deterministic router on 5xx/503. */
async function requestTurn(
  text: string,
  ticket: Ticket,
  history: SimMessage[],
  kbDocs: KbDoc[],
  orders: Order[],
  persona: Persona,
): Promise<SimTurn> {
  const messages = [
    ...history
      .filter((message) => message.role !== "system")
      .slice(-9)
      .map((message) => ({
        role: message.role === "customer" ? "customer" : "assistant",
        content: message.text,
      })),
    { role: "customer", content: text },
  ];

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id, messages, kbDocs, orders }),
    });

    if (response.ok) {
      return mapLlmTurn((await response.json()) as LlmChatResponse, kbDocs);
    }
  } catch {
    // Network or parse failure — fall through to the deterministic router.
  }

  const fallback = await postJSON<ChatReplyPayload>("/api/chat/simulate", {
    message: text,
    orderId: persona.orderId,
  });

  return mapSimTurn(fallback);
}

export default function CustomerSimulator() {
  const {
    tickets,
    orders,
    kbDocs,
    addTicketMessage,
    addKnowledgeGap,
    updateTicket,
  } = useDeskStore();

  const [open, setOpen] = useState(false);
  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [thread, setThread] = useState<SimMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState<string | null>(null);

  const persona = PERSONAS.find((item) => item.id === personaId) ?? PERSONAS[0];
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread, open, busy]);

  function switchPersona(nextPersonaId: string) {
    setPersonaId(nextPersonaId);
    setThread([]);
    setDraft("");
    setLastRoute(null);
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || busy) return;

    const ticket = resolveTicket(text, persona.orderId, tickets);
    if (!ticket) {
      setThread((prev) => [
        ...prev,
        { id: nextId(), role: "system", text: "No ticket available to route this message." },
      ]);
      return;
    }

    setBusy(true);
    setDraft("");
    setThread((prev) => [...prev, { id: nextId(), role: "customer", text }]);
    setLastRoute(`${ticket.id} · ${ticket.customerName}`);

    // Mirror the customer message onto the shared ticket immediately.
    addTicketMessage(ticket.id, {
      sender: "customer",
      senderName: persona.label,
      text,
    });

    try {
      const turn = await requestTurn(text, ticket, thread, kbDocs, orders, persona);

      let reply = turn.reply;
      const actions = turn.actions.map((action) =>
        newActionLog(action.type, action.label, action.detail),
      );
      let escalate = turn.escalate;

      if (turn.refundOrderId) {
        const refund = await postJSON<RefundResult>("/api/actions", {
          action: "process_refund",
          orderId: turn.refundOrderId,
          reason: text,
        });

        if (refund.status === "APPROVED") {
          reply = `Done ✅ ${refund.message} It reaches your account in 5–7 working days.`;
          actions.push(
            newActionLog(
              "tool_call",
              `Refund executed · ₹${refund.refundAmount}`,
              `${turn.refundOrderId} · auto-approved at or below ₹1,000`,
            ),
          );
        } else if (refund.status === "GUARDRAIL_BLOCKED") {
          reply = `${refund.message} I've escalated this to a support manager, so a human reviews ₹${refund.refundAmount} on priority — you don't need to do anything else.`;
          actions.push(
            newActionLog(
              "escalation",
              "Guardrail blocked the refund",
              `₹${refund.refundAmount} > ₹1,000 ceiling · ${turn.refundOrderId} · priority URGENT`,
            ),
          );
          escalate = true;
        } else {
          reply = `I couldn't find ${turn.refundOrderId} in our records. Could you re-check the order ID from your confirmation message?`;
        }
      }

      addTicketMessage(ticket.id, {
        sender: "ai",
        senderName: "DeskPilot AI",
        text: reply,
        citations: turn.citations.length ? turn.citations : undefined,
        actions,
      });

      setThread((prev) => {
        const next: SimMessage[] = [
          ...prev,
          { id: nextId(), role: "ai", text: reply, citations: turn.citations },
        ];
        if (turn.usedFallback) {
          next.push({
            id: nextId(),
            role: "system",
            text: "LLM route unavailable (no OPENAI_API_KEY?) — answered with the deterministic policy router.",
          });
        }
        return next;
      });

      if (turn.knowledgeGap) addKnowledgeGap(text, ticket.channel);

      // Classifier output and escalations land on the ticket so the console
      // queue reflects them immediately.
      const patch: {
        priority?: TicketPriority;
        category?: TicketCategory;
        status?: TicketStatus;
      } = {};

      if (turn.category) patch.category = turn.category;
      if (turn.priority) patch.priority = turn.priority;
      if (escalate) {
        patch.priority = "urgent";
        if (ticket.status === "ai_handling") patch.status = "escalated";
      }

      if (Object.keys(patch).length > 0) updateTicket(ticket.id, patch);
    } catch (error) {
      setThread((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "system",
          text: `Request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2.5 text-xs font-semibold text-charcoal-950 shadow-glow transition hover:bg-amber-300"
      >
        <MessageCircle className="h-4 w-4" />
        Test as customer
      </button>
    );
  }

  return (
    <aside className="fixed bottom-4 right-4 z-40 flex h-[min(660px,84vh)] w-[min(392px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl2 border border-brand-400/40 bg-charcoal-900/95 shadow-glow backdrop-blur">
      <header className="border-b border-charcoal-700 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <MessageCircle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-cream-50">
              Customer simulator
            </p>
            <p className="text-[10px] text-ash-400">
              Replies land in the agent console
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close simulator"
            className="focus-ring rounded-full border border-charcoal-600 p-1 text-ash-300 transition hover:text-cream-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="mt-2 block">
          <span className="sr-only">Customer</span>
          <select
            value={persona.id}
            onChange={(event) => switchPersona(event.target.value)}
            className="focus-ring w-full rounded-lg border border-charcoal-600 bg-charcoal-850 px-2 py-1.5 text-[11px] text-cream-100"
          >
            {PERSONAS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div
        ref={threadRef}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {thread.length === 0 ? (
          <p className="rounded-lg border border-dashed border-charcoal-600 px-3 py-4 text-center text-[11px] leading-relaxed text-ash-400">
            Type as {persona.label.split(" (")[0]} or tap a quick prompt below.
            Watching the console, you&apos;ll see the same thread, citations and
            guardrails.
          </p>
        ) : null}

        {thread.map((message) => {
          if (message.role === "system") {
            return (
              <p
                key={message.id}
                className="mx-auto max-w-[92%] rounded-lg border border-dashed border-charcoal-600 bg-charcoal-900/60 px-2.5 py-1.5 text-center text-[10px] text-ash-400"
              >
                {message.text}
              </p>
            );
          }

          const isCustomer = message.role === "customer";

          return (
            <div
              key={message.id}
              className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl border px-2.5 py-2 text-[11px] leading-relaxed ${
                  isCustomer
                    ? "rounded-br-md border-brand-400/50 bg-brand-500/85 text-cream-50"
                    : "rounded-bl-md border-charcoal-600 bg-charcoal-800 text-cream-100"
                }`}
              >
                <p className="whitespace-pre-line">{message.text}</p>

                {message.citations?.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {message.citations.map((citation, index) => (
                      <span
                        key={`${message.id}-${index}`}
                        title={citation.snippet}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-cream-200/20 bg-cream-200/10 px-1.5 py-0.5 text-[9px] text-cream-200"
                      >
                        <span aria-hidden>📄</span>
                        <span className="truncate">
                          {citation.title} {citation.version}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {busy ? (
          <p className="flex items-center gap-1.5 text-[10px] text-ash-400">
            <Sparkles className="h-3 w-3 animate-pulse text-cream-200" />
            DeskPilot AI is typing…
          </p>
        ) : null}
      </div>

      <div className="border-t border-charcoal-700 px-3 py-2">
        <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-ash-400">
          Quick test prompts
        </p>
        <div className="space-y-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={busy}
              onClick={() => void send(prompt)}
              className="focus-ring block w-full rounded-lg border border-charcoal-600 bg-charcoal-850/70 px-2 py-1 text-left text-[10px] leading-snug text-ash-300 transition hover:border-brand-400 hover:text-cream-100 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="border-t border-charcoal-700 px-3 py-2.5"
      >
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            disabled={busy}
            placeholder={`Message as ${persona.label.split(" (")[0]}…`}
            className="focus-ring max-h-24 min-h-[34px] flex-1 resize-none rounded-lg border border-charcoal-600 bg-charcoal-850 px-2.5 py-1.5 text-[11px] text-cream-100 placeholder:text-ash-400/70 focus:border-brand-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="focus-ring inline-flex h-[34px] items-center gap-1 rounded-lg bg-amber-400 px-2.5 text-[11px] font-semibold text-charcoal-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-charcoal-700 disabled:text-ash-400"
          >
            <Send className="h-3 w-3" />
            Send
          </button>
        </div>
        <p className="mt-1 text-[9px] text-ash-400">
          {lastRoute
            ? `Last message added to ${lastRoute}`
            : "Messages are written to the matching ticket"}
        </p>
      </form>
    </aside>
  );
}
