import { describe, expect, test } from "vitest";
import type { BomGroup } from "../src/bom/types";
import { defaultTakeQuantity } from "../src/welding/quantity";

const group: BomGroup = {
  componentKey: "C1",
  name: "",
  value: "",
  package: "",
  manufacturer: "",
  mpn: "",
  lcscCode: "",
  placements: [
    { designator: "C1", side: "top", componentKey: "C1" },
    { designator: "C2", side: "top", componentKey: "C1" },
    { designator: "C3", side: "bottom", componentKey: "C1" },
  ],
  extraFields: {},
};

describe("defaultTakeQuantity", () => {
  test("counts placements independently by board side", () => {
    expect(defaultTakeQuantity(group, "top")).toBe(2);
    expect(defaultTakeQuantity(group, "bottom")).toBe(1);
  });

  test("returns a summary for all without making all a board side", () => {
    expect(defaultTakeQuantity(group, "all")).toEqual({ top: 2, bottom: 1 });
  });
});
