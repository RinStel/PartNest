import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BomImportPage, type BomImportApi } from "./BomImportPage";
import type { Part } from "../../app/tauri";

afterEach(cleanup);

const part = (overrides: Partial<Part> = {}): Part => ({
  id: "part-1", name: "10k", category: "", package: "0603", manufacturer: "", mpn: "", lcsc_code: "C1", quantity: 3,
  box_id: "box-1", slot: "A0", note: "", version: 1, ...overrides,
});

const ready = {
  kind: "Ready" as const,
  bom: {
    source_name: "bom.csv",
    groups: [{ component_key: "lcsc:C1", name: "R1", value: "10k", package: "0603", manufacturer: "", mpn: "", lcsc_code: "C1", quantity: 5, designators: ["R1"], placements: [], extra_fields: {} }],
  },
};

function api(overrides: Partial<BomImportApi> = {}): BomImportApi {
  return {
    inspectTabularBom: vi.fn().mockResolvedValue(ready),
    cacheInteractiveBom: vi.fn(),
    listParts: vi.fn().mockResolvedValue([part()]),
    ...overrides,
  };
}

describe("BomImportPage", () => {
  it("restricts the picker to supported BOM formats and reports unsupported files", async () => {
    const pickFile = vi.fn().mockResolvedValue("board.txt");
    render(<BomImportPage api={api()} pickFile={pickFile} />);

    const input = screen.getByLabelText("选择 BOM 文件");
    expect(input).toHaveAttribute("accept", ".html,.csv,.xlsx");
    fireEvent.change(input, { target: { files: [new File([""], "board.txt")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不支持的 BOM 格式"));
  });

  it("shows mapping fields and prevents a source column from being mapped twice", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    const pickFile = vi.fn().mockResolvedValue("board.csv");
    render(<BomImportPage api={api({ inspectTabularBom })} pickFile={pickFile} />);
    fireEvent.change(screen.getByLabelText("选择 BOM 文件"), { target: { files: [new File([""], "board.csv")] } });
    expect(await screen.findByText("字段映射")).toBeInTheDocument();
    const fields = screen.getAllByRole("combobox");
    fireEvent.change(fields[0], { target: { value: "Part" } });
    fireEvent.change(fields[1], { target: { value: "Part" } });
    expect(fields[1]).toHaveValue("");
  });

  it("turns the cached interactive HTML normalized payload into analysis rows", async () => {
    const cacheInteractiveBom = vi.fn().mockResolvedValue({ normalized: ready.bom });
    const apiMock = api({ cacheInteractiveBom });
    render(<BomImportPage api={apiMock} pickFile={vi.fn().mockResolvedValue("board.html")} />);
    fireEvent.change(screen.getByLabelText("选择 BOM 文件"), { target: { files: [new File([""], "board.html")] } });
    expect(await screen.findByText("缺料分析")).toBeInTheDocument();
    expect(cacheInteractiveBom).toHaveBeenCalledWith("board.html", "board.html");
  });

  it("analyzes exact, candidate, and unmatched groups with non-negative shortages", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({
      kind: "Ready" as const,
      bom: { source_name: "bom.csv", groups: [
        { component_key: "lcsc:C1", name: "R1", value: "10k", package: "0603", manufacturer: "", mpn: "", lcsc_code: "C1", quantity: 5, designators: ["R1"], placements: [], extra_fields: {} },
        { component_key: "candidate", name: "LED", value: "red", package: "0603", manufacturer: "", mpn: "", lcsc_code: "", quantity: 2, designators: ["D1", "D2"], placements: [], extra_fields: {} },
        { component_key: "none", name: "MCU", value: "x", package: "QFN", manufacturer: "", mpn: "missing", lcsc_code: "", quantity: 1, designators: ["U1"], placements: [], extra_fields: {} },
      ] },
    });
    const pickFile = vi.fn().mockResolvedValue("bom.csv");
    render(<BomImportPage api={api({ inspectTabularBom, listParts: vi.fn().mockResolvedValue([
      part({ id: "exact", lcsc_code: "C1", quantity: 8 }),
      part({ id: "candidate-a", name: "red", lcsc_code: "", quantity: 1 }),
      part({ id: "candidate-b", name: "red", lcsc_code: "", quantity: 4 }),
    ]) })} pickFile={pickFile} />);
    fireEvent.change(screen.getByLabelText("选择 BOM 文件"), { target: { files: [new File([""], "bom.csv")] } });
    expect(await screen.findByText("缺料分析")).toBeInTheDocument();
    expect(screen.getByText("精确匹配")).toBeInTheDocument();
    expect(screen.getByText("候选匹配")).toBeInTheDocument();
    expect(screen.getByText("未匹配")).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "0" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "确认匹配" }).length).toBeGreaterThan(0);
  });

  it("keeps a candidate unresolved until the user confirms a part", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({
      kind: "Ready" as const,
      bom: { source_name: "bom.csv", groups: [{ component_key: "candidate", name: "LED", value: "red", package: "0603", manufacturer: "", mpn: "", lcsc_code: "", quantity: 2, designators: ["D1"], placements: [], extra_fields: {} }] },
    });
    render(<BomImportPage api={api({ inspectTabularBom, listParts: vi.fn().mockResolvedValue([part({ id: "a", name: "red", lcsc_code: "" }), part({ id: "b", name: "red", lcsc_code: "" })]) })} pickFile={vi.fn().mockResolvedValue("bom.csv")} />);
    fireEvent.change(screen.getByLabelText("选择 BOM 文件"), { target: { files: [new File([""], "bom.csv")] } });
    expect(await screen.findByText("候选匹配")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "确认匹配" })[0]);
    await waitFor(() => expect(screen.queryByText("候选匹配")).not.toBeInTheDocument());
    expect(screen.getByText("精确匹配")).toBeInTheDocument();
  });
});
