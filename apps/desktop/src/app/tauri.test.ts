import { describe, expect, it, vi } from "vitest";
import { desktopApi, errorMessage, normalizePart, type TakeResult } from "./tauri";

describe("frontend Tauri boundary", () => {
  it("maps a serialized conflict into the refresh message", () => {
    expect(errorMessage({ code: "Conflict" })).toBe("数据已被其他操作修改，请刷新后重试");
  });

  it("normalizes nullable Rust metadata", () => {
    expect(normalizePart({
      id: "p", name: "part", category: null, package: null, manufacturer: null,
      mpn: null, lcsc_code: null, quantity: 0, box_id: 1, slot: "A0", note: null, version: 1,
    })).toMatchObject({ category: "", package: "", manufacturer: "", mpn: "", lcsc_code: "", note: "" });
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";

it("adapts the Rust externally tagged preview at the IPC boundary", async () => {
  const bom = { source_name: "board.csv", groups: [] };
  vi.mocked(invoke).mockResolvedValueOnce({ Ready: bom });
  expect(await desktopApi.analyzeProject("p")).toEqual({ kind: "Ready", bom });
});

it("accepts the exact take response without inventing input-only fields", () => {
  const response: TakeResult = {
    movement_id: "m", session_id: "s", component_key: "c", side: "top", part_id: "p",
    take_quantity: 1, required_quantity: 1, consumed_quantity: 1, taken_quantity: 1,
    status: "taken", part_version: 2,
  };
  expect(response.part_version).toBe(2);
});
