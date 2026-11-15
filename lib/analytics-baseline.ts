/**
 * Seeded 30-day baseline for DeskPilot analytics.
 *
 * Kept in its own module, apart from the live store, so the UI can always say
 * which part of a metric is historical and which part came from real tickets.
 * Nothing here is mutated; `AnalyticsView` layers live store data on top.
 */
export const ANALYTICS_BASELINE = {
  conversations: 210,
  /** 150 / 210 = 71.4% AI containment before live tickets are added. */
  aiContained: 150,
  csatSum: 580.3,
  csatCount: 124,
  avgAiSeconds: 1.4,
  avgHumanSeconds: 380, // 6m 20s
  guardrailSavedInr: 16_700,
  guardrailCases: 9,
} as const;
