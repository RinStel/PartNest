import { invoke } from "@tauri-apps/api/core";

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

export type DesktopApi = {
  listBoxes: () => Promise<Box[]>;
  createBox: (input: Pick<Box, "name" | "rows" | "cols">) => Promise<Box>;
  resizeBox: (id: string, rows: number, cols: number) => Promise<Box>;
  listParts: (search?: string) => Promise<Part[]>;
  createPart: (input: PartInput) => Promise<Part>;
  updatePart: (id: string, expectedVersion: number, input: PartInput) => Promise<Part>;
  adjustStock: (id: string, delta: number, reason: string) => Promise<Part>;
};

export const desktopApi: DesktopApi = {
  listBoxes: () => invoke("list_boxes"),
  createBox: (input) => invoke("create_box", { input }),
  resizeBox: (id, rows, cols) => invoke("resize_box", { id, rows, cols }),
  listParts: (search) => invoke("list_parts", { search }),
  createPart: (input) => invoke("create_part", { input }),
  updatePart: (id, expectedVersion, input) => invoke("update_part", { id, expectedVersion, input }),
  adjustStock: (id, delta, reason) => invoke("adjust_stock", { id, delta, reason }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "操作失败，请稍后重试";
}

