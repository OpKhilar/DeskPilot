import type { Order } from "./types";

// Server-side order book for the demo APIs (/api/chat, /api/actions).
//
// The browser store (lib/store.ts) carries its own copy for offline demos, but
// money decisions must never trust a client-supplied amount — so every refund
// is checked against these records, not against whatever the chat sent.

export const ORDERS: Order[] = [
  {
    id: "ORD-101",
    customerName: "Ananya Sharma",
    customerPhone: "+91 98200 41127",
    customerCity: "Mumbai",
    items: [
      {
        id: "itm-101-1",
        name: "Everyday Cotton Kurta (Indigo, M)",
        quantity: 1,
        price: 499,
      },
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
      {
        id: "itm-104-1",
        name: "Handloom Cotton Saree (Mustard)",
        quantity: 1,
        price: 2400,
      },
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
];
