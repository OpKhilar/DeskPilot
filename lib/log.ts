import type { ActionLog } from "./types";

let sequence = 0;

/**
 * Build a complete ActionLog for optimistic client writes — the store does not
 * assign ids or timestamps for actions passed through addTicketMessage.
 */
export function newActionLog(
  type: ActionLog["type"],
  label: string,
  detail?: string,
): ActionLog {
  sequence += 1;
  return {
    id: `act-${Date.now().toString(36)}-${sequence}`,
    type,
    label,
    detail,
    timestamp: new Date().toISOString(),
  };
}
