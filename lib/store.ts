"use client";

// DeskPilot store: a small React Context reducer-ish store with localStorage
// persistence and realistic Indian D2C seed data, so every screen has something
// to work against from the first render.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  DeskState,
  KbDoc,
  KnowledgeGap,
  KnowledgeGapStatus,
  NewTicketMessage,
  Order,
  OrderStatus,
  Ticket,
  TicketChannel,
  TicketStatus,
  NewActionLog,
} from "./types";

export const STORAGE_KEY = "deskpilot:state:v1";
export const RESET_EVENT = "deskpilot:reset";

/* -------------------------------------------------------------------------- */
/* Seed data                                                                  */
/* -------------------------------------------------------------------------- */

export const seedState: DeskState = {
  orders: [
    {
      id: "ORD-101",
      customerName: "Ananya Sharma",
      customerPhone: "+91 98200 41127",
      customerCity: "Mumbai",
      items: [
        { id: "itm-101-1", name: "Everyday Cotton Kurta (Indigo, M)", quantity: 1, price: 499 },
      ],
      amount: 499,
      status: "Delivered",
      paymentMethod: "UPI",
      placedAt: "2026-11-02T11:24:00+05:30",
      updatedAt: "2026-11-06T16:05:00+05:30",
      awb: "DELH-8841209375",
      carrier: "Delhivery",
    },
    {
      id: "ORD-102",
      customerName: "Rohan Mehta",
      customerPhone: "+91 98705 33418",
      customerCity: "Pune",
      items: [
        {
          id: "itm-102-1",
          name: "Terracotta Dinner Set (12 pcs)",
          quantity: 1,
          price: 2499,
        },
      ],
      amount: 2499,
      status: "In Transit",
      paymentMethod: "Card",
      placedAt: "2026-11-11T19:05:00+05:30",
      updatedAt: "2026-11-14T09:12:00+05:30",
      awb: "BLDT-55203184",
      carrier: "Bluedart",
    },
    {
      id: "ORD-103",
      customerName: "Rahul Deshmukh",
      customerPhone: "+91 90045 87210",
      customerCity: "Nagpur",
      items: [
        { id: "itm-103-1", name: "Brass Puja Thali Set", quantity: 1, price: 850 },
      ],
      amount: 850,
      status: "Damaged",
      paymentMethod: "COD",
      placedAt: "2026-11-13T10:40:00+05:30",
      updatedAt: "2026-11-15T09:18:00+05:30",
      awb: "EKRT-77120945",
      carrier: "Ekart",
    },
    {
      id: "ORD-104",
      customerName: "Sneha Iyer",
      customerPhone: "+91 99620 77451",
      customerCity: "Bengaluru",
      items: [
        { id: "itm-104-1", name: "Handloom Cotton Saree (Mustard)", quantity: 1, price: 2400 },
        { id: "itm-104-2", name: "Oxidised Silver Earrings", quantity: 1, price: 800 },
      ],
      amount: 3200,
      status: "Delivered",
      paymentMethod: "UPI",
      placedAt: "2026-10-29T14:12:00+05:30",
      updatedAt: "2026-11-01T12:40:00+05:30",
      awb: "DELH-7731902488",
      carrier: "Delhivery",
    },
    {
      id: "ORD-105",
      customerName: "Imran Qureshi",
      customerPhone: "+91 93110 20984",
      customerCity: "Hyderabad",
      items: [
        {
          id: "itm-105-1",
          name: "Cold-Pressed Coconut Oil 500ml",
          quantity: 1,
          price: 350,
        },
      ],
      amount: 350,
      status: "Processing",
      paymentMethod: "UPI",
      placedAt: "2026-11-15T08:55:00+05:30",
      updatedAt: "2026-11-15T08:57:00+05:30",
    },
  ],

  kbDocs: [
    {
      id: "kb-return-refund",
      title: "Return & Refund Policy",
      version: "v1.2",
      category: "Returns",
      updatedAt: "2026-10-28T18:30:00+05:30",
      citationCount: 148,
      content:
        "Customers may raise a return within 7 days of delivery for unused, unwashed items with tags intact. Damaged, defective or wrong items must be reported within 48 hours of delivery with unboxing photos or a video; these qualify for a full refund including shipping. Approved refunds are credited to the original payment method within 5–7 working days, or to store credit within 24 hours if the customer prefers. Made-to-order, personalised and innerwear items are non-returnable unless damaged. Reverse pickup is free for serviceable pin codes; where pickup is unavailable, customers may self-ship and upload the courier receipt for reimbursement up to ₹150.",
    },
    {
      id: "kb-shipping",
      title: "Shipping Timelines",
      version: "v1.2",
      category: "Shipping",
      updatedAt: "2026-10-28T18:30:00+05:30",
      citationCount: 132,
      content:
        "Metro pin codes are delivered in 2–4 working days, tier-2 cities in 3–6 working days and North-East, Jammu & Kashmir, Himachal and island pin codes in 7–10 working days. Orders placed before 2 PM IST are dispatched the same working day; orders placed on Sunday or a national holiday are dispatched on the next working day. Tracking links activate within 24 hours of dispatch and sometimes take up to 6 hours to refresh after a scan. Delayed shipments (more than 48 hours past the promised date) are eligible for a ₹100 shipping credit on request.",
    },
    {
      id: "kb-warranty",
      title: "Warranty Terms",
      version: "v1.2",
      category: "Warranty",
      updatedAt: "2026-10-28T18:30:00+05:30",
      citationCount: 57,
      content:
        "Household and kitchen products carry a 6-month manufacturing warranty from the date of delivery, covering seams, joints, handles and structural defects. Brass and copper items naturally develop a patina; that is not a defect and is not covered. Silver-plated and oxidised jewellery has a 30-day plating warranty, after which re-polishing is chargeable at ₹199. Warranty claims need the order ID and a photo or short video of the issue; replacements ship within 3 working days of approval. Accidental damage, misuse, dishwasher use on handwash-only items and normal wear are excluded.",
    },
    {
      id: "kb-payments",
      title: "UPI & Payment Failures",
      version: "v1.2",
      category: "Payments",
      updatedAt: "2026-10-28T18:30:00+05:30",
      citationCount: 91,
      content:
        "If money was debited but the order was not confirmed, the amount is auto-reversed by the bank or UPI PSP within 48 hours. Customers should not retry the payment immediately; share the UPI reference number (12 digits, starting with the bank code) or a screenshot so support can reconcile it. Failed payments never create a duplicate order, and COD is unavailable on orders above ₹5,000 or on pin codes marked prepaid-only. Refunds to UPI land in 3–5 working days, card refunds in 5–7 working days and netbanking refunds in 7–9 working days.",
    },
  ],

  tickets: [
    {
      id: "TKT-201",
      subject: "Brass thali set arrived damaged — refund chahiye",
      customerName: "Rahul Deshmukh",
      customerPhone: "+91 90045 87210",
      channel: "WhatsApp",
      status: "escalated",
      priority: "urgent",
      category: "Damaged Product",
      orderId: "ORD-103",
      assignedTo: "Neha Kulkarni (Support Lead)",
      createdAt: "2026-11-15T09:12:00+05:30",
      slaDeadline: "2026-11-15T13:12:00+05:30",
      tags: ["damaged", "refund", "hinglish", "cod"],
      messages: [
        {
          id: "msg-201-1",
          sender: "customer",
          senderName: "Rahul Deshmukh",
          text: "Bhai mera order ORD-103 damaged aaya hai, refund chahiye. Box phatela hua tha aur thali ka edge toota hua hai.",
          timestamp: "2026-11-15T09:12:00+05:30",
        },
        {
          id: "msg-201-2",
          sender: "ai",
          senderName: "DeskPilot AI",
          text: "Sorry Rahul ji, yeh bilkul theek nahi hai 🙏 Damaged item 48 ghante ke andar report karne par aapko full refund milta hai, shipping charges ke saath. Main abhi damage photos attach kar raha hoon aur refund request raise kar raha hoon — agle step mein aapko confirmation bhejunga.",
          timestamp: "2026-11-15T09:12:40+05:30",
          citations: [
            {
              docId: "kb-return-refund",
              title: "Return & Refund Policy",
              version: "v1.2",
              snippet:
                "Damaged, defective or wrong items must be reported within 48 hours of delivery with unboxing photos or a video; these qualify for a full refund including shipping.",
            },
          ],
          actions: [
            {
              id: "act-201-1",
              type: "knowledge_lookup",
              label: "Retrieved 2 policy passages",
              detail: "Return & Refund Policy v1.2 · Return window + refund timeline",
              timestamp: "2026-11-15T09:12:31+05:30",
            },
            {
              id: "act-201-2",
              type: "order_lookup",
              label: "Linked order ORD-103",
              detail: "Brass Puja Thali Set · ₹850 · COD · Delivered 14 Nov",
              timestamp: "2026-11-15T09:12:33+05:30",
            },
            {
              id: "act-201-3",
              type: "tool_call",
              label: "Requested unboxing photos",
              detail: "WhatsApp media request sent",
              timestamp: "2026-11-15T09:12:38+05:30",
            },
          ],
        },
        {
          id: "msg-201-3",
          sender: "customer",
          senderName: "Rahul Deshmukh",
          text: "Photos bhej diye hain WhatsApp par. Refund kitne din mein aayega? COD tha to paisa kaise milega?",
          timestamp: "2026-11-15T09:18:00+05:30",
        },
        {
          id: "msg-201-4",
          sender: "ai",
          senderName: "DeskPilot AI",
          text: "Photos mil gayi hain, thank you. COD order ka refund aapke UPI ya bank account mein hota hai, 5–7 working days mein. Maine details verify kar li hain, lekin COD refund ke liye manual approval chahiye — main ise support lead ko hand over kar raha hoon, koi aur detail nahi chahiye hogi.",
          timestamp: "2026-11-15T09:18:35+05:30",
          citations: [
            {
              docId: "kb-return-refund",
              title: "Return & Refund Policy",
              version: "v1.2",
              snippet:
                "Approved refunds are credited to the original payment method within 5–7 working days, or to store credit within 24 hours if the customer prefers.",
            },
          ],
          actions: [
            {
              id: "act-201-4",
              type: "escalation",
              label: "Escalated to human agent",
              detail: "Reason: COD refund requires manual UPI verification",
              timestamp: "2026-11-15T09:18:36+05:30",
            },
            {
              id: "act-201-5",
              type: "assignment",
              label: "Assigned to Neha Kulkarni",
              detail: "SLA breach risk in 4h · priority raised to urgent",
              timestamp: "2026-11-15T09:18:38+05:30",
            },
          ],
        },
        {
          id: "msg-201-5",
          sender: "system",
          text: "Refund request RF-8842 created for ₹850. Awaiting payment-team approval before the 1:12 PM SLA.",
          timestamp: "2026-11-15T09:22:10+05:30",
          actions: [
            {
              id: "act-201-6",
              type: "system",
              label: "Refund draft created",
              detail: "RF-8842 · ₹850 to customer UPI",
              timestamp: "2026-11-15T09:22:10+05:30",
            },
          ],
        },
      ],
    },
    {
      id: "TKT-202",
      subject: "ORD-102 tracking link open nahi ho raha",
      customerName: "Rohan Mehta",
      customerPhone: "+91 98705 33418",
      channel: "Instagram DM",
      status: "ai_handling",
      priority: "medium",
      category: "Order Tracking",
      orderId: "ORD-102",
      createdAt: "2026-11-15T10:02:00+05:30",
      slaDeadline: "2026-11-15T18:02:00+05:30",
      tags: ["tracking", "hinglish", "shipping"],
      messages: [
        {
          id: "msg-202-1",
          sender: "customer",
          senderName: "Rohan Mehta",
          text: "Bhai ORD-102 ka tracking link open nahi ho raha, parcel kahan pahuncha? 3 din se same status dikha raha hai.",
          timestamp: "2026-11-15T10:02:00+05:30",
        },
        {
          id: "msg-202-2",
          sender: "ai",
          senderName: "DeskPilot AI",
          text: "Rohan ji, aapka parcel Bluedart ke saath transit mein hai — AWB BLDT-55203184. Tracking links dispatch ke baad 24 ghante mein active hote hain aur scan ke baad 6 ghante tak refresh hone mein time lete hain, isliye status purana lag sakta hai. Pune delivery 3–6 working days mein hoti hai, to 17 Nov tak expect kar sakte hain. Agar 17 Nov ke baad bhi update na aaye to main aapko ₹100 shipping credit ke saath priority trace raise kar dunga.",
          timestamp: "2026-11-15T10:02:45+05:30",
          citations: [
            {
              docId: "kb-shipping",
              title: "Shipping Timelines",
              version: "v1.2",
              snippet:
                "Tracking links activate within 24 hours of dispatch and sometimes take up to 6 hours to refresh after a scan.",
            },
            {
              docId: "kb-shipping",
              title: "Shipping Timelines",
              version: "v1.2",
              snippet:
                "Delayed shipments (more than 48 hours past the promised date) are eligible for a ₹100 shipping credit on request.",
            },
          ],
          actions: [
            {
              id: "act-202-1",
              type: "order_lookup",
              label: "Fetched shipment status",
              detail: "Delhivery/Bluedart API · In Transit, last scan 14 Nov, Chakan hub",
              timestamp: "2026-11-15T10:02:38+05:30",
            },
            {
              id: "act-202-2",
              type: "knowledge_lookup",
              label: "Matched Shipping Timelines v1.2",
              detail: "Tier-2 delivery estimate + tracking refresh window",
              timestamp: "2026-11-15T10:02:41+05:30",
            },
          ],
        },
      ],
    },
    {
      id: "TKT-203",
      subject: "UPI se ₹1,199 kat gaye par order confirm nahi hua",
      customerName: "Kavya Menon",
      customerPhone: "+91 97440 62190",
      channel: "Web Chat",
      status: "human_takeover",
      priority: "high",
      category: "Payments",
      assignedTo: "Arjun Pillai (Payments)",
      createdAt: "2026-11-15T08:41:00+05:30",
      slaDeadline: "2026-11-15T12:41:00+05:30",
      tags: ["upi", "payment-failure", "hinglish", "reconciliation"],
      messages: [
        {
          id: "msg-203-1",
          sender: "customer",
          senderName: "Kavya Menon",
          text: "UPI se ₹1,199 deduct ho gaye lekin order confirm nahi hua. Screenshot bheja hai, reference number bhi hai. Paisa wapas kab aayega?",
          timestamp: "2026-11-15T08:41:00+05:30",
        },
        {
          id: "msg-203-2",
          sender: "ai",
          senderName: "DeskPilot AI",
          text: "Kavya ji, pareshan na hon — debited amount bank ya UPI PSP 48 ghante mein auto-reverse karta hai. Dobara payment retry mat kijiye, isse duplicate order ban sakta hai. Aapka screenshot mil gaya hai (₹1,199, ref 4189••••7723); main ise payment team ko reconciliation ke liye de raha hoon.",
          timestamp: "2026-11-15T08:41:50+05:30",
          citations: [
            {
              docId: "kb-payments",
              title: "UPI & Payment Failures",
              version: "v1.2",
              snippet:
                "If money was debited but the order was not confirmed, the amount is auto-reversed by the bank or UPI PSP within 48 hours.",
            },
          ],
          actions: [
            {
              id: "act-203-1",
              type: "tool_call",
              label: "Searched payment gateway ledger",
              detail: "Razorpay · no captured payment for this cart session",
              timestamp: "2026-11-15T08:41:44+05:30",
            },
            {
              id: "act-203-2",
              type: "escalation",
              label: "Flagged for manual reconciliation",
              detail: "UPI ref 4189••••7723 · amount mismatch with gateway ledger",
              timestamp: "2026-11-15T08:41:52+05:30",
            },
          ],
        },
        {
          id: "msg-203-3",
          sender: "agent",
          senderName: "Arjun Pillai",
          text: "Hi Kavya, Arjun here from payments. I've pulled your UPI reference and raised a reconciliation request with the PSP. If it isn't auto-reversed by tomorrow 10 AM, I'll process a manual refund to the same UPI ID and confirm here.",
          timestamp: "2026-11-15T08:58:00+05:30",
          actions: [
            {
              id: "act-203-3",
              type: "assignment",
              label: "Human takeover by Arjun Pillai",
              detail: "AI suggestions paused for this thread",
              timestamp: "2026-11-15T08:55:00+05:30",
            },
          ],
        },
      ],
    },
    {
      id: "TKT-204",
      subject: "Oxidised earrings plating warranty — kab tak?",
      customerName: "Sneha Iyer",
      customerPhone: "+91 99620 77451",
      channel: "WhatsApp",
      status: "resolved",
      priority: "low",
      category: "Warranty",
      orderId: "ORD-104",
      assignedTo: "DeskPilot AI",
      createdAt: "2026-11-14T16:20:00+05:30",
      slaDeadline: "2026-11-15T16:20:00+05:30",
      satisfactionScore: 5,
      tags: ["warranty", "jewellery", "resolved"],
      messages: [
        {
          id: "msg-204-1",
          sender: "customer",
          senderName: "Sneha Iyer",
          text: "Order ORD-104 ke earrings ka black polish utar raha hai 15 din mein. Kya warranty milegi ya paid service hai?",
          timestamp: "2026-11-14T16:20:00+05:30",
        },
        {
          id: "msg-204-2",
          sender: "ai",
          senderName: "DeskPilot AI",
          text: "Sneha ji, oxidised jewellery par 30 din ki plating warranty hai, to aapka case cover ho jayega. Order ID aur ek close-up photo chahiye — main replacement request draft kar deta hoon, approval ke baad 3 working days mein ship ho jayega.",
          timestamp: "2026-11-14T16:20:40+05:30",
          citations: [
            {
              docId: "kb-warranty",
              title: "Warranty Terms",
              version: "v1.2",
              snippet:
                "Silver-plated and oxidised jewellery has a 30-day plating warranty, after which re-polishing is chargeable at ₹199.",
            },
          ],
          actions: [
            {
              id: "act-204-1",
              type: "order_lookup",
              label: "Verified delivery date",
              detail: "ORD-104 delivered 1 Nov · 13 days ago",
              timestamp: "2026-11-14T16:20:34+05:30",
            },
            {
              id: "act-204-2",
              type: "draft",
              label: "Drafted replacement request",
              detail: "Plating defect within 30-day window",
              timestamp: "2026-11-14T16:20:42+05:30",
            },
          ],
        },
        {
          id: "msg-204-3",
          sender: "customer",
          senderName: "Sneha Iyer",
          text: "Perfect, photo bhej di. Thank you!",
          timestamp: "2026-11-14T16:26:00+05:30",
        },
        {
          id: "msg-204-4",
          sender: "system",
          text: "Replacement approved and ticket resolved automatically. CSAT 5/5.",
          timestamp: "2026-11-14T16:27:00+05:30",
          actions: [
            {
              id: "act-204-3",
              type: "resolution",
              label: "Auto-resolved",
              detail: "Replacement created · CSAT 5/5",
              timestamp: "2026-11-14T16:27:00+05:30",
            },
          ],
        },
      ],
    },
  ],

  knowledgeGaps: [
    {
      id: "gap-301",
      query: "Do you deliver to Port Blair?",
      status: "open",
      frequency: 9,
      channel: "Web Chat",
      firstSeenAt: "2026-11-02T12:10:00+05:30",
      lastSeenAt: "2026-11-15T09:47:00+05:30",
      resolutionNote:
        "Shipping policy lists island pin codes in 7–10 days but has no serviceability list, so the AI could not confirm.",
    },
    {
      id: "gap-302",
      query: "COD available hai kya ₹5,000 se upar ke orders par?",
      status: "in_review",
      frequency: 6,
      channel: "WhatsApp",
      firstSeenAt: "2026-11-05T18:22:00+05:30",
      lastSeenAt: "2026-11-14T20:05:00+05:30",
      resolutionNote:
        "Policy says COD is unavailable above ₹5,000, but agents sometimes allow it for repeat customers — needs one clear rule.",
      suggestedKbDocId: "kb-payments",
    },
    {
      id: "gap-303",
      query: "Do you provide GST invoices for bulk corporate gifting orders?",
      status: "open",
      frequency: 3,
      channel: "Email",
      firstSeenAt: "2026-11-09T11:30:00+05:30",
      lastSeenAt: "2026-11-13T15:12:00+05:30",
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function cloneSeed(): DeskState {
  return JSON.parse(JSON.stringify(seedState)) as DeskState;
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Clear the persisted store and reset every hook consumer to the seed data. */
export function resetStore(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode, quota) — in-memory reset still works.
  }
  window.dispatchEvent(new Event(RESET_EVENT));
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface DeskStoreValue extends DeskState {
  /** False during the first client render, before localStorage is read. */
  hydrated: boolean;
  addTicketMessage: (ticketId: string, message: NewTicketMessage) => void;
  updateTicket: (ticketId: string, patch: Partial<Ticket>) => void;
  updateTicketStatus: (ticketId: string, status: TicketStatus) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  addKbDoc: (doc: KbDoc) => void;
  updateKbDoc: (docId: string, patch: Partial<KbDoc>) => void;
  recordCitation: (docId: string) => void;
  addKnowledgeGap: (query: string, channel?: TicketChannel) => void;
  updateKnowledgeGap: (gapId: string, patch: Partial<KnowledgeGap>) => void;
  setKnowledgeGapStatus: (gapId: string, status: KnowledgeGapStatus) => void;
  logAction: (ticketId: string, log: NewActionLog) => void;
  resetStore: () => void;
}

const DeskStoreContext = createContext<DeskStoreValue | null>(null);

export function DeskStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeskState>(seedState);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once, tolerating old or corrupt payloads.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DeskState>;
        setState({
          orders: Array.isArray(parsed.orders) ? parsed.orders : seedState.orders,
          kbDocs: Array.isArray(parsed.kbDocs) ? parsed.kbDocs : seedState.kbDocs,
          tickets: Array.isArray(parsed.tickets)
            ? parsed.tickets
            : seedState.tickets,
          knowledgeGaps: Array.isArray(parsed.knowledgeGaps)
            ? parsed.knowledgeGaps
            : seedState.knowledgeGaps,
        });
      }
    } catch {
      // Corrupt payload: fall back to seed data.
    }
    setHydrated(true);
  }, []);

  // Persist after hydration so the seed is never overwritten before it loads.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota / disabled storage.
    }
  }, [state, hydrated]);

  const resetState = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setState(cloneSeed());
    setHydrated(true);
  }, []);

  // Lets `resetStore()` work from outside React (e.g. a dev console).
  useEffect(() => {
    window.addEventListener(RESET_EVENT, resetState);
    return () => window.removeEventListener(RESET_EVENT, resetState);
  }, [resetState]);

  const addTicketMessage = useCallback<DeskStoreValue["addTicketMessage"]>(
    (ticketId, message) => {
      setState((prev) => ({
        ...prev,
        tickets: prev.tickets.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                messages: [
                  ...ticket.messages,
                  {
                    ...message,
                    id: makeId("msg"),
                    timestamp: message.timestamp ?? nowIso(),
                  },
                ],
              }
            : ticket,
        ),
      }));
    },
    [],
  );

  const updateTicket = useCallback<DeskStoreValue["updateTicket"]>(
    (ticketId, patch) => {
      setState((prev) => ({
        ...prev,
        tickets: prev.tickets.map((ticket) =>
          ticket.id === ticketId ? { ...ticket, ...patch } : ticket,
        ),
      }));
    },
    [],
  );

  const updateTicketStatus = useCallback<DeskStoreValue["updateTicketStatus"]>(
    (ticketId, status) => updateTicket(ticketId, { status }),
    [updateTicket],
  );

  const updateOrderStatus = useCallback<DeskStoreValue["updateOrderStatus"]>(
    (orderId, status) => {
      setState((prev) => ({
        ...prev,
        orders: prev.orders.map((order: Order) =>
          order.id === orderId
            ? { ...order, status, updatedAt: nowIso() }
            : order,
        ),
      }));
    },
    [],
  );

  const addKbDoc = useCallback<DeskStoreValue["addKbDoc"]>((doc) => {
    setState((prev) => {
      const exists = prev.kbDocs.some((item) => item.id === doc.id);
      return {
        ...prev,
        kbDocs: exists
          ? prev.kbDocs.map((item) => (item.id === doc.id ? doc : item))
          : [...prev.kbDocs, doc],
      };
    });
  }, []);

  const updateKbDoc = useCallback<DeskStoreValue["updateKbDoc"]>(
    (docId, patch) => {
      setState((prev) => ({
        ...prev,
        kbDocs: prev.kbDocs.map((doc) =>
          doc.id === docId ? { ...doc, ...patch } : doc,
        ),
      }));
    },
    [],
  );

  const recordCitation = useCallback<DeskStoreValue["recordCitation"]>(
    (docId) => {
      setState((prev) => ({
        ...prev,
        kbDocs: prev.kbDocs.map((doc) =>
          doc.id === docId
            ? { ...doc, citationCount: doc.citationCount + 1 }
            : doc,
        ),
      }));
    },
    [],
  );

  const addKnowledgeGap = useCallback<DeskStoreValue["addKnowledgeGap"]>(
    (query, channel = "Web Chat") => {
      setState((prev) => {
        const existing = prev.knowledgeGaps.find(
          (gap) => gap.query.toLowerCase() === query.trim().toLowerCase(),
        );
        if (existing) {
          return {
            ...prev,
            knowledgeGaps: prev.knowledgeGaps.map((gap) =>
              gap.id === existing.id
                ? {
                    ...gap,
                    frequency: gap.frequency + 1,
                    lastSeenAt: nowIso(),
                  }
                : gap,
            ),
          };
        }
        return {
          ...prev,
          knowledgeGaps: [
            ...prev.knowledgeGaps,
            {
              id: makeId("gap"),
              query: query.trim(),
              status: "open" as KnowledgeGapStatus,
              frequency: 1,
              channel,
              firstSeenAt: nowIso(),
              lastSeenAt: nowIso(),
            },
          ],
        };
      });
    },
    [],
  );

  const updateKnowledgeGap = useCallback<DeskStoreValue["updateKnowledgeGap"]>(
    (gapId, patch) => {
      setState((prev) => ({
        ...prev,
        knowledgeGaps: prev.knowledgeGaps.map((gap) =>
          gap.id === gapId ? { ...gap, ...patch } : gap,
        ),
      }));
    },
    [],
  );

  const setKnowledgeGapStatus = useCallback<
    DeskStoreValue["setKnowledgeGapStatus"]
  >(
    (gapId, status) => updateKnowledgeGap(gapId, { status }),
    [updateKnowledgeGap],
  );

  const logAction = useCallback<DeskStoreValue["logAction"]>(
    (ticketId, log) => {
      setState((prev) => ({
        ...prev,
        tickets: prev.tickets.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                messages: ticket.messages.map((message, index) =>
                  index === ticket.messages.length - 1
                    ? {
                        ...message,
                        actions: [
                          ...(message.actions ?? []),
                          {
                            ...log,
                            id: makeId("act"),
                            timestamp: log.timestamp ?? nowIso(),
                          },
                        ],
                      }
                    : message,
                ),
              }
            : ticket,
        ),
      }));
    },
    [],
  );

  const value = useMemo<DeskStoreValue>(
    () => ({
      ...state,
      hydrated,
      addTicketMessage,
      updateTicket,
      updateTicketStatus,
      updateOrderStatus,
      addKbDoc,
      updateKbDoc,
      recordCitation,
      addKnowledgeGap,
      updateKnowledgeGap,
      setKnowledgeGapStatus,
      logAction,
      resetStore: resetState,
    }),
    [
      state,
      hydrated,
      addTicketMessage,
      updateTicket,
      updateTicketStatus,
      updateOrderStatus,
      addKbDoc,
      updateKbDoc,
      recordCitation,
      addKnowledgeGap,
      updateKnowledgeGap,
      setKnowledgeGapStatus,
      logAction,
      resetState,
    ],
  );

  // No JSX here so this file can stay a .ts module.
  return createElement(DeskStoreContext.Provider, { value }, children);
}

/** Read and mutate DeskPilot state from any client component. */
export function useDeskStore(): DeskStoreValue {
  const context = useContext(DeskStoreContext);
  if (!context) {
    throw new Error("useDeskStore must be used inside <DeskStoreProvider>.");
  }
  return context;
}
