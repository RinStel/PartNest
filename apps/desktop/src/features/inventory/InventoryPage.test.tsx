import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { InventoryPage } from "./InventoryPage";

afterEach(cleanup);
const part = { id: "part-1", name: "10k resistor", category: "resistor", package: "0603", manufacturer: "Acme", mpn: "R-10K", lcsc_code: "C1", quantity: 3, box_id: "box-1", slot: "A0", note: "", version: 1 };

describe("InventoryPage", () => {
  it("shows the complete part form in a drawer", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
    expect(screen.getByRole("dialog", { name: "新增器件" })).toBeVisible();
    for (const label of ["名称", "分类", "封装", "制造商", "MPN", "LCSC", "收纳盒 ID", "盒位", "数量", "备注"]) expect(screen.getByLabelText(label)).toBeVisible();
  });

  it("keeps fixed metadata columns and calls audited adjustment API", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([part]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn().mockResolvedValue({ ...part, quantity: 5, version: 2 }) };
    render(<MemoryRouter><InventoryPage api={api} /></MemoryRouter>);
    expect(await screen.findByText("10k resistor")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "制造商" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("10k resistor调整数量"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "调整" }));
    await waitFor(() => expect(api.adjustStock).toHaveBeenCalledWith("part-1", 2, "手工调整"));
  });

  it("saves all editable metadata and keeps quantity read-only during edit", async () => {
    const api = { listParts: vi.fn().mockResolvedValue([part]), createPart: vi.fn(), updatePart: vi.fn().mockResolvedValue({ ...part, name: "edited", version: 2 }), adjustStock: vi.fn() };
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
