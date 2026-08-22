import { describe, expect, test } from "vitest";
import type { BomGroup, InventoryPart } from "../src/bom/types";
import { matchBomGroup } from "../src/bom/matching";

const group = (overrides: Partial<BomGroup> = {}): BomGroup => ({
  componentKey: "R1",
  name: "",
  value: "",
  package: "",
  manufacturer: "",
  mpn: "",
  lcscCode: "",
  placements: [],
  extraFields: {},
  ...overrides,
});

const part = (overrides: Partial<InventoryPart> = {}): InventoryPart => ({
  id: "part-1",
  name: "",
  package: "",
  mpn: "",
  lcscCode: "",
  ...overrides,
});

describe("matchBomGroup", () => {
  test("prefers exact LCSC matching", () => {
    expect(matchBomGroup(group({ lcscCode: " C1 " }), [part({ lcscCode: "C1", id: "lcsc" })])).toEqual({
      kind: "exact-lcsc",
      partId: "lcsc",
    });
  });

  test("matches MPN with trim and Unicode lowercase", () => {
    expect(matchBomGroup(group({ mpn: "  ÄBC  " }), [part({ mpn: "äbc", id: "mpn" })])).toEqual({
      kind: "exact-mpn",
      partId: "mpn",
    });
  });

  test("returns candidates for matching value or name and package", () => {
    expect(matchBomGroup(group({ value: "10k", package: "0603" }), [part({ name: "10k", package: "0603", id: "candidate" })])).toEqual({
      kind: "candidate",
      partIds: ["candidate"],
    });
  });

  test("does not return a candidate when package differs", () => {
    expect(matchBomGroup(group({ value: "10k", package: "0402" }), [part({ name: "10k", package: "0603" })])).toEqual({ kind: "none" });
  });

  test("does not use MPN when a BOM LCSC code is present", () => {
    expect(matchBomGroup(group({ lcscCode: "C1", mpn: "ABC" }), [part({ mpn: "abc" })])).toEqual({ kind: "none" });
  });
});
