import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { InventoryPage } from "./InventoryPage";

afterEach(cleanup);
const part = { id: "part-1", name: "10k resistor", category: "resistor", package: "0603", manufacturer: "Acme", mpn: "R-10K", lcsc_code: "C1", quantity: 3, box_id: 1, slot: "A0", note: "", version: 1 };
const box = { id: 1, name: "BOX1", rows: 2, cols: 2, occupied_slots: ["A0"] };

describe("InventoryPage", () => {
  it("shows the complete part form in a drawer", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([]), listBoxes: vi.fn().mockResolvedValue([box]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    expect(screen.getByRole("dialog", { name: "新增器件" })).toBeVisible();
    for (const label of ["名称", "分类", "封装", "制造商", "MPN", "LCSC", "收纳盒", "盒位", "数量", "备注"]) expect(screen.getByLabelText(label)).toBeVisible();
  });

  it("submits the selected box integer ID instead of its visible name and never autocompletes slots", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([]), listBoxes: vi.fn().mockResolvedValue([box]), createPart: vi.fn().mockResolvedValue({ ...part, quantity: 99 }), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    await screen.findByRole("option", { name: "BOX1" });
    fireEvent.change(screen.getByLabelText("收纳盒"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "选择盒位" }));
    expect(screen.getByRole("button", { name: "A0 已占用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "A1 空闲" }));
    const quantity = screen.getByLabelText("数量");
    expect(quantity).toHaveAttribute("autocomplete", "off");
    fireEvent.change(quantity, { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "new part" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.createPart).toHaveBeenCalledWith(expect.objectContaining({ box_id: 1, slot: "A1", quantity: 99 })));
  });

  it("refreshes occupied slots before starting the next new part", async () => {
    const listBoxes = vi.fn()
      .mockResolvedValueOnce([{ ...box, occupied_slots: [] }])
      .mockResolvedValueOnce([{ ...box, occupied_slots: ["A0"] }]);
    const api = { listParts: vi.fn().mockResolvedValue([]), listBoxes, createPart: vi.fn().mockResolvedValue({ ...part, slot: "A0" }), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    await screen.findByRole("option", { name: "BOX1" });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "first" } });
    fireEvent.change(screen.getByLabelText("收纳盒"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "选择盒位" }));
    fireEvent.click(screen.getByRole("button", { name: "A0 空闲" }));
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.createPart).toHaveBeenCalledWith(expect.objectContaining({ slot: "A0" })));

    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    fireEvent.change(screen.getByLabelText("收纳盒"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "选择盒位" }));
    expect(await screen.findByRole("button", { name: "A0 已占用" })).toBeDisabled();
    expect(listBoxes).toHaveBeenCalledTimes(2);
  });

  it("allows zero-stock parts to be saved without occupying a box slot", async () => {
    const createPart = vi.fn().mockResolvedValue({ ...part, quantity: 0, box_id: null, slot: null });
    const api = { listParts: vi.fn().mockResolvedValue([]), listBoxes: vi.fn().mockResolvedValue([box]), createPart, updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "未入库器件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(createPart).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0, box_id: null, slot: null })));
  });

  it("moves an existing part to another box and slot", async () => {
    const secondBox = { ...box, id: 2, name: "BOX2", occupied_slots: [] };
    const updatePart = vi.fn().mockResolvedValue({ ...part, box_id: 2, slot: "B1", version: 2 });
    const api = { listParts: vi.fn().mockResolvedValue([part]), listBoxes: vi.fn().mockResolvedValue([box, secondBox]), createPart: vi.fn(), updatePart, adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("收纳盒"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "选择盒位" }));
    fireEvent.click(screen.getByRole("button", { name: "B1 空闲" }));
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(updatePart).toHaveBeenCalledWith("part-1", 1, expect.objectContaining({ box_id: 2, slot: "B1" })));
  });

  it("fills only blank fields from an explicit LCSC lookup", async () => {
    const api = {
      listParts: vi.fn().mockResolvedValue([]), listBoxes: vi.fn().mockResolvedValue([box]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn(),
      lookupLcsc: vi.fn().mockResolvedValue({ lcsc_code: "C25804", name: "100kΩ 电阻", category: "电阻", package: "0402", manufacturer: "UNI-ROYAL", mpn: "0402WGF1003TEE" }),
    };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    fireEvent.change(screen.getByLabelText("LCSC"), { target: { value: "C25804" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "手填名称" } });
    fireEvent.click(screen.getByRole("button", { name: "查询 LCSC" }));
    await waitFor(() => expect(api.lookupLcsc).toHaveBeenCalledWith("C25804"));
    expect(screen.getByLabelText("名称")).toHaveValue("手填名称");
    expect(screen.getByLabelText("分类")).toHaveValue("电阻");
    expect(screen.getByLabelText("封装")).toHaveValue("0402");
    expect(screen.getByLabelText("制造商")).toHaveValue("UNI-ROYAL");
    expect(screen.getByLabelText("MPN")).toHaveValue("0402WGF1003TEE");
  });

  it("routes cancel and repeated new through dirty confirmation", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "pending" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "新增器件" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("名称")).toHaveValue("pending");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新增器件" })).not.toBeInTheDocument());
  });

  it("keeps the table focused on picking information and calls audited adjustment API", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([part]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn().mockResolvedValue({ ...part, quantity: 5, version: 2 }) };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    expect(await screen.findByText("10k resistor")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "规格" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "制造商" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("10k resistor调整数量"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "调整" }));
    await waitFor(() => expect(api.adjustStock).toHaveBeenCalledWith("part-1", 2, "手工调整"));
  });

  it("shows LCSC ID as a dedicated inventory column", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([part]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    expect(await screen.findByRole("columnheader", { name: "LCSC ID" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "C1" })).toBeInTheDocument();
  });

  it("shows the box name instead of its persisted integer ID in the picking list", async () => {
    const boxId = 42;
    const api = {
      listParts: vi.fn().mockResolvedValue([{ ...part, box_id: boxId, slot: "A0" }]),
      listBoxes: vi.fn().mockResolvedValue([{ ...box, id: boxId, name: "贴片电阻" }]),
      createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn(),
    };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    expect(await screen.findByText("贴片电阻 / A0")).toBeInTheDocument();
    expect(screen.queryByText(`盒子 #${boxId} / A0`)).not.toBeInTheDocument();
  });

  it("keeps a compact empty state and a retryable user-facing load failure", async () => {
    const listParts = vi.fn().mockRejectedValue(new Error("Cannot read properties of undefined (reading 'invoke')"));
    const api = { listParts, createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取库存失败");
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(listParts).toHaveBeenCalledTimes(2));
  });

  it("saves all editable metadata and keeps quantity read-only during edit", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([part]), listBoxes: vi.fn().mockResolvedValue([box]), createPart: vi.fn(), updatePart: vi.fn().mockResolvedValue({ ...part, name: "edited", version: 2 }), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    await screen.findByText("10k resistor");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("数量")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "edited" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.updatePart).toHaveBeenCalledWith("part-1", 1, expect.objectContaining({ name: "edited", note: "test", quantity: 3 })));
  });
});
