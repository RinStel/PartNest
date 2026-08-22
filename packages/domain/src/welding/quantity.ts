import type { BomGroup, BomSide } from "../bom/types";

export type TakeQuantity = number | { top: number; bottom: number };

export function defaultTakeQuantity(group: BomGroup, side: BomSide | "all"): TakeQuantity {
  const top = group.placements.filter((placement) => placement.side === "top").length;
  const bottom = group.placements.filter((placement) => placement.side === "bottom").length;
  return side === "all" ? { top, bottom } : side === "top" ? top : bottom;
}
