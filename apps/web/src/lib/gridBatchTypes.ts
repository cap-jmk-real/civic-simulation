import type { SimulationRun, WorldState } from "@ip-sim/core";
import type { GridAxisAssignment } from "@/lib/gridAxes";

/** One completed cell from the parameter grid batch runner. */
export type GridCellResult = {
  id: string;
  label: string;
  assignments: GridAxisAssignment[];
  run: SimulationRun & { finalWorld: WorldState };
};
