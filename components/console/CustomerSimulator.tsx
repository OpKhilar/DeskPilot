"use client";

// Floating customer-side chat used to demo DeskPilot end to end on one screen.
//
// Every message is mirrored into the real ticket through useDeskStore, so the
// agent console reacts live. Understanding + policy answers come from
// /api/chat; any money action is executed by /api/actions, where the ₹1,000
// ceiling lives in code.

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useDeskStore } from "@/lib/store";
import { newActionLog } from "@/lib/log";
import type { ChatReplyPayload, RefundResult } from "@/lib/actions";
import type { Citation, Ticket } from "@/lib/types";

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

interface SimMessage {
  id: string;
  role: "customer" | "ai" | "system";
  text: string;
  citations?: Citation[];
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

export default function CustomerSimulator() {
  const { tickets, addTicketMessage, addKnowledgeGap, updateTicket } = useDeskStore();

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
      const chat = await postJSON<ChatReplyPayload>("/api/chat", {
        message: text,
        orderId: persona.orderId,
      });

      let reply = chat.reply;
      const actions = chat.actions.map((action) =>
        newActionLog(action.type, action.label, action.detail),
      );
      let escalated = false;

      if (chat.toolCall) {
        const refund = await postJSON<RefundResult>("/api/actions", {
          action: "process_refund",
          orderId: chat.toolCall.orderId,
          reason: text,
        });

        if (refund.status === "APPROVED") {
          reply = `Done ✅ ${refund.message} It reaches your account in 5–7 working days.`;
          actions.push(
            newActionLog(
              "tool_call",
              `Refund executed · ₹${refund.refundAmount}`,
              `${chat.toolCall.orderId} · auto-approved at or below ₹1,000`,
            ),
          );
        } else if (refund.status === "GUARDRAIL_BLOCKED") {
          reply = `${refund.message} I've escalated this to a support manager, so a human reviews ₹${refund.refundAmount} on priority — you don't need to do anything else.`;
          actions.push(
            newActionLog(
              "escalation",
              "Guardrail blocked the refund",
              `₹${refund.refundAmount} > ₹1,000 ceiling · ${chat.toolCall.orderId} · priority URGENT`,
            ),
          );
          escalated = true;
        } else {
          reply = `I couldn't find ${chat.toolCall.orderId} in our records. Could you re-check the order ID from your confirmation message?`;
        }
      }

      addTicketMessage(ticket.id, {
        sender: "ai",
        senderName: "DeskPilot AI",
        text: reply,
        citations: chat.citations.length ? chat.citations : undefined,
        actions,
      });

      setThread((prev) => [
        ...prev,
        { id: nextId(), role: "ai", text: reply, citations: chat.citations },
      ]);

      if (chat.knowledgeGap) addKnowledgeGap(text, ticket.channel);

      // A blocked refund is a human's problem now.
      if (escalated && ticket.status === "ai_handling") {
        updateTicket(ticket.id, { status: "escalated", priority: "urgent" });
      }
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
