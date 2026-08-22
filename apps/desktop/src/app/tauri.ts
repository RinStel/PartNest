import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Box = {
  id: string;
  name: string;
  rows: number;
  cols: number;
  occupied_slots: string[];
};

export type PartInput = {
  name: string;
  category: string;
  package: string;
  manufacturer: string;
  mpn: string;
  lcsc_code: string;
  quantity: number;
  box_id: string;
  slot: string;
  note: string;
};

export type Part = PartInput & { id: string; version: number };

/** Converts the Rust cache PathBuf into a Tauri asset URL for webview loads. */
export function cachedBomUrl(cachePath: string): string {
  try {
    return convertFileSrc(cachePath);
  } catch {
    // Browser-only tests and the static Vite preview have no Tauri internals.
    return cachePath;
  }
}

export type BomSide = "top" | "bottom";
export type BomPlacement = { designator: string; side: BomSide | null; component_key: string };
export type BomGroup = {
  component_key: string;
  name: string;
  value: string;
  package: string;
  manufacturer: string;
  mpn: string;
  lcsc_code: string;
  quantity: number;
  designators: string[];
  placements: BomPlacement[];
  extra_fields: Record<string, string>;
};
export type CachedBomSession = {
  session_id: string;
  bom_file_id: string;
  original_name: string;
  display_name: string;
  sha256: string;
  cache_name: string;
  cache_path: string;
  token: string;
  normalized: { source_name: string; groups: BomGroup[] };
};
export type ResolvedBomSelection = {
  session_id: string;
  component_key: string;
  side: BomSide;
  designators: string[];
};
export type ConfirmTakeInput = {
  session_id: string;
  component_key: string;
  side: BomSide;
  designators: string[];
  bom_quantity: number;
  take_quantity: number;
  part_id: string;
  expected_part_version: number;
};
export type TakeResult = ConfirmTakeInput & {
  movement_id: string;
  required_quantity: number;
  consumed_quantity: number;
  taken_quantity: number;
  status: string;
  part_version: number;
};
export type WeldingProgress = {
  session_id: string;
  component_key: string;
  side: BomSide;
  part_id: string | null;
  required_quantity: number;
  consumed_quantity: number;
  taken_quantity: number;
  status: string;
};

export type DesktopApi = {
  listBoxes: () => Promise<Box[]>;
  createBox: (input: Pick<Box, "name" | "rows" | "cols">) => Promise<Box>;
  resizeBox: (id: string, rows: number, cols: number) => Promise<Box>;
  listParts: (search?: string) => Promise<Part[]>;
  createPart: (input: PartInput) => Promise<Part>;
  updatePart: (id: string, expectedVersion: number, input: PartInput) => Promise<Part>;
  adjustStock: (id: string, delta: number, reason: string) => Promise<Part>;
  restoreActiveInteractiveBom: () => Promise<CachedBomSession | null>;
  resolveBomSelection: (token: string, designators: string[]) => Promise<ResolvedBomSelection>;
  confirmTake: (input: ConfirmTakeInput) => Promise<TakeResult>;
  getWeldingProgress: (sessionId: string) => Promise<WeldingProgress[]>;
};

export const desktopApi: DesktopApi = {
  listBoxes: () => invoke("list_boxes"),
  createBox: (input) => invoke("create_box", { input }),
  resizeBox: (id, rows, cols) => invoke("resize_box", { id, rows, cols }),
  listParts: (search) => invoke("list_parts", { search }),
  createPart: (input) => invoke("create_part", { input }),
  updatePart: (id, expectedVersion, input) => invoke("update_part", { id, expectedVersion, input }),
  adjustStock: (id, delta, reason) => invoke("adjust_stock", { id, delta, reason }),
  restoreActiveInteractiveBom: () => invoke("restore_active_interactive_bom"),
  resolveBomSelection: (token, designators) => invoke("resolve_bom_selection", { token, designators }),
  confirmTake: (input) => invoke("confirm_take", { input }),
  getWeldingProgress: (sessionId) => invoke("get_welding_progress", { sessionId }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "操作失败，请稍后重试";
}
