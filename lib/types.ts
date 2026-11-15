// DeskPilot domain model.
// All money is stored as whole rupees (INR) and never as paise floats.

export type OrderStatus =
  | "Processing"
  | "In Transit"
  | "Delivered"
  | "Damaged"
  | "Cancelled";

export type PaymentMethod = "UPI" | "Card" | "COD" | "Netbanking";

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  /** Unit price in INR. */
  price: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  items: OrderItem[];
  /** Order total in INR. */
  amount: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** ISO 8601 timestamps. */
  placedAt: string;
  updatedAt: string;
  awb?: string;
  carrier?: string;
}

export type KbCategory = "Returns" | "Shipping" | "Warranty" | "Payments";

export interface KbDoc {
  id: string;
  title: string;
  /** Policy revision shown alongside citations, e.g. "v1.2". */
  version: string;
  content: string;
  category: KbCategory;
  updatedAt: string;
  citationCount: number;
}

export type TicketStatus =
  | "ai_handling"
  | "escalated"
  | "human_takeover"
  | "resolved";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

export type TicketCategory =
  | "Order Tracking"
  | "Damaged Product"
  | "Refund"
  | "Payments"
  | "Warranty"
  | "Product Query"
  | "Other";

export type TicketChannel =
  | "WhatsApp"
  | "Instagram DM"
  | "Web Chat"
  | "Email";

export type MessageSender = "customer" | "ai" | "agent" | "system";

export interface Citation {
  docId: string;
  title: string;
  version: string;
  /** Exact passage the AI quoted. */
  snippet: string;
}

export type ActionLogType =
  | "knowledge_lookup"
  | "order_lookup"
  | "draft"
  | "tool_call"
  | "escalation"
  | "assignment"
  | "resolution"
  | "system";

export interface ActionLog {
  id: string;
  type: ActionLogType;
  label: string;
  detail?: string;
  timestamp: string;
}

export interface TicketMessage {
  id: string;
  sender: MessageSender;
  /** Display name for agents, "DeskPilot AI" for the model, customer name for customers. */
  senderName?: string;
  text: string;
  timestamp: string;
  citations?: Citation[];
  actions?: ActionLog[];
  internal?: boolean;
}

export interface Ticket {
  id: string;
  subject: string;
  customerName: string;
  customerPhone: string;
  channel: TicketChannel;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  /** Linked order, when the conversation is about one. */
  orderId?: string;
  assignedTo?: string;
  createdAt: string;
  /** ISO timestamp by which the first response / resolution is due. */
  slaDeadline: string;
  messages: TicketMessage[];
  tags: string[];
  satisfactionScore?: number;
}

export type KnowledgeGapStatus = "open" | "in_review" | "resolved";

export interface KnowledgeGap {
  id: string;
  /** The customer question the AI could not answer from the knowledge base. */
  query: string;
  status: KnowledgeGapStatus;
  /** How many times customers have asked this in the last 30 days. */
  frequency: number;
  channel: TicketChannel;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Why the AI fell back to a human. */
  resolutionNote?: string;
  suggestedKbDocId?: string;
}

export interface DeskState {
  orders: Order[];
  kbDocs: KbDoc[];
  tickets: Ticket[];
  knowledgeGaps: KnowledgeGap[];
}

export type NewTicketMessage = Omit<TicketMessage, "id" | "timestamp"> & {
  timestamp?: string;
};

export type NewActionLog = Omit<ActionLog, "id" | "timestamp"> & {
  timestamp?: string;
};
