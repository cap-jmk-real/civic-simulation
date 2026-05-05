import type { LabBatchCellRow } from "./labSessionsStore";
import { hasPersistedLabTrialRunPayload } from "./labRunJsonResolver";

export type LabBatchCellSummary = {
  id: string;
  session_id: string;
  cell_index: number;
  cell_client_id: string | null;
  label: string | null;
  has_run_payload: boolean;
  created_at: string;
};

export function toLabBatchCellSummary(cell: LabBatchCellRow): LabBatchCellSummary {
  return {
    id: cell.id,
    session_id: cell.session_id,
    cell_index: cell.cell_index,
    cell_client_id: cell.cell_client_id,
    label: cell.label,
    has_run_payload: hasPersistedLabTrialRunPayload({
      runSummaryJson: cell.run_summary_json,
      spilloverPath: cell.spillover_path,
    }),
    created_at: cell.created_at,
  };
}
