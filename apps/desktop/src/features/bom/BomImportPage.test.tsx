import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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

function renderPage(ui: JSX.Element) {
  return render(<MemoryRouter initialEntries={["/bom"]}>{ui}</MemoryRouter>);
}

describe("BomImportPage", () => {
  it("restricts the picker to supported BOM formats and reports unsupported files", async () => {
    const pickFile = vi.fn().mockResolvedValue("board.txt");
    renderPage(<BomImportPage api={api()} pickFile={pickFile} />);

    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(pickFile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不支持的 BOM 格式"));
  });

  it("shows mapping fields and prevents a source column from being mapped twice", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    const pickFile = vi.fn().mockResolvedValue("board.csv");
    renderPage(<BomImportPage api={api({ inspectTabularBom })} pickFile={pickFile} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByText("字段映射")).toBeInTheDocument();
    const fields = screen.getAllByRole("combobox");
    fireEvent.change(fields[0], { target: { value: "Part" } });
    fireEvent.change(fields[1], { target: { value: "Part" } });
    expect(fields[1]).toHaveValue("");
  });

  it("turns the cached interactive HTML normalized payload into analysis rows", async () => {
    const cacheInteractiveBom = vi.fn().mockResolvedValue({ normalized: ready.bom });
    const apiMock = api({ cacheInteractiveBom });
    renderPage(<BomImportPage api={apiMock} pickFile={vi.fn().mockResolvedValue("board.html")} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByText("缺料分析")).toBeInTheDocument();
    expect(cacheInteractiveBom).toHaveBeenCalledWith("board.html", "board.html");
  });

  it("passes an edited BOM remark name when importing interactive HTML", async () => {
    const cacheInteractiveBom = vi.fn().mockResolvedValue({ normalized: ready.bom });
    renderPage(<BomImportPage api={api({ cacheInteractiveBom })} pickFile={vi.fn().mockResolvedValue("board.html")} />);
    fireEvent.change(screen.getByLabelText("BOM备注名"), { target: { value: "我的板子" } });
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    await screen.findByText("缺料分析");
    expect(cacheInteractiveBom).toHaveBeenCalledWith("board.html", "我的板子");
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
    renderPage(<BomImportPage api={api({ inspectTabularBom, listParts: vi.fn().mockResolvedValue([
      part({ id: "exact", lcsc_code: "C1", quantity: 8 }),
      part({ id: "candidate-a", name: "red", lcsc_code: "", quantity: 1 }),
      part({ id: "candidate-b", name: "red", lcsc_code: "", quantity: 4 }),
    ]) })} pickFile={pickFile} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
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
    renderPage(<BomImportPage api={api({ inspectTabularBom, listParts: vi.fn().mockResolvedValue([part({ id: "a", name: "red", lcsc_code: "" }), part({ id: "b", name: "red", lcsc_code: "" })]) })} pickFile={vi.fn().mockResolvedValue("bom.csv")} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByText("候选匹配")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "确认匹配" })[0]);
    await waitFor(() => expect(screen.queryByText("候选匹配")).not.toBeInTheDocument());
    expect(screen.getByText("精确匹配")).toBeInTheDocument();
  });

  it("keeps import controls in the toolbar and opens mapping as a dialog", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    renderPage(<BomImportPage api={api({ inspectTabularBom })} pickFile={vi.fn().mockResolvedValue("board.csv")} />);

    const toolbar = screen.getByRole("toolbar", { name: "BOM 操作工具栏" });
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "选择文件" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByRole("dialog", { name: "字段映射" })).toBeVisible();
  });

  it("cancels mapping without importing and keeps duplicate source fields disabled", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    renderPage(<BomImportPage api={api({ inspectTabularBom })} pickFile={vi.fn().mockResolvedValue("board.csv")} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    const dialog = await screen.findByRole("dialog", { name: "字段映射" });
    const fields = screen.getAllByRole("combobox");
    fireEvent.change(fields[0], { target: { value: "Part" } });
    expect(screen.getAllByRole("option", { name: "Part" })[1]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "字段映射" })).not.toBeInTheDocument());
    expect(dialog).not.toBeVisible();
    expect(inspectTabularBom).toHaveBeenCalledTimes(1);
  });

  it("renders candidate and shortage values as compact status content", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({
      kind: "Ready" as const,
      bom: { source_name: "bom.csv", groups: [{ component_key: "candidate", name: "LED", value: "red", package: "0603", manufacturer: "", mpn: "", lcsc_code: "", quantity: 5, designators: ["D1"], placements: [], extra_fields: {} }] },
    });
    renderPage(<BomImportPage api={api({ inspectTabularBom, listParts: vi.fn().mockResolvedValue([part({ id: "a", name: "red", lcsc_code: "", quantity: 2 }), part({ id: "b", name: "red", lcsc_code: "", quantity: 1 })]) })} pickFile={vi.fn().mockResolvedValue("bom.csv")} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    const candidate = await screen.findByText("候选匹配");
    expect(candidate.closest("[role=\"status\"]")).toHaveAttribute("data-tone", "warning");
    expect(screen.getAllByRole("cell", { name: "5" }).length).toBeGreaterThan(0);
  });

  it("restores the previous BOM when a replacement mapping is cancelled", async () => {
    const inspectTabularBom = vi.fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    const pickFile = vi.fn()
      .mockResolvedValueOnce("old.csv")
      .mockResolvedValueOnce("new.csv");
    renderPage(<BomImportPage api={api({ inspectTabularBom })} pickFile={pickFile} />);

    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByText("缺料分析")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByRole("dialog", { name: "字段映射" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "字段映射" })).not.toBeInTheDocument());
    expect(screen.getByText("缺料分析")).toBeInTheDocument();
    expect(screen.getByLabelText("BOM备注名")).toHaveValue("old.csv");
    expect(screen.getByTitle("old.csv")).toBeInTheDocument();
  });

  it("clears the automatically filled filename after cancelling the first mapping", async () => {
    const inspectTabularBom = vi.fn().mockResolvedValue({ kind: "NeedsMapping" as const, headers: ["Part", "Qty"], suggestions: {} });
    renderPage(<BomImportPage api={api({ inspectTabularBom })} pickFile={vi.fn().mockResolvedValue("new.csv")} />);
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    expect(await screen.findByRole("dialog", { name: "字段映射" })).toBeVisible();
    expect(screen.getByLabelText("BOM备注名")).toHaveValue("new.csv");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "字段映射" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("BOM备注名")).toHaveValue("");
    expect(screen.queryByTitle("new.csv")).not.toBeInTheDocument();
    expect(screen.queryByText("缺料分析")).not.toBeInTheDocument();
  });
});
