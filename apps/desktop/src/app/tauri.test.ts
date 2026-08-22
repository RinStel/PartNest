import { describe, expect, it } from "vitest";
import { errorMessage, normalizePart } from "./tauri";

describe("frontend Tauri boundary", () => {
  it("maps a serialized conflict into the refresh message", () => {
    expect(errorMessage({ code: "Conflict" })).toBe("数据已被其他操作修改，请刷新后重试");
  });

  it("normalizes nullable Rust metadata", () => {
    expect(normalizePart({
      id: "p", name: "part", category: null, package: null, manufacturer: null,
      mpn: null, lcsc_code: null, quantity: 0, box_id: "b", slot: "A0", note: null, version: 1,
    })).toMatchObject({ category: "", package: "", manufacturer: "", mpn: "", lcsc_code: "", note: "" });
  });
});
