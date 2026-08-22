import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryPage } from "./InventoryPage";

afterEach(cleanup);

describe("InventoryPage", () => {
  it("searches inventory and exposes edit and stock adjustment actions", async () => {
    const api = {
      listParts: vi.fn().mockResolvedValue([{ id: "part-1", name: "10k resistor", category: "resistor", package: "0603", manufacturer: "", mpn: "R-10K", lcsc_code: "C1", quantity: 3, box_id: "box-1", slot: "A0", note: "", version: 1 }]),
      createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn(),
    };
    render(<InventoryPage api={api} />);
    expect(await screen.findByText("10k resistor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "调整数量" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("名称、MPN 或 LCSC"), { target: { value: "10k" } });
    await waitFor(() => expect(api.listParts).toHaveBeenLastCalledWith("10k"));
  });

  it("sends create, metadata edit, and stock adjustment payloads", async () => {
    const part = { id: "part-1", name: "10k resistor", category: "resistor", package: "0603", manufacturer: "", mpn: "R-10K", lcsc_code: "C1", quantity: 3, box_id: "box-1", slot: "A0", note: "", version: 1 };
    const api = {
      listParts: vi.fn().mockResolvedValue([part]),
      createPart: vi.fn().mockResolvedValue({ ...part, id: "part-2", name: "new part" }),
      updatePart: vi.fn().mockResolvedValue({ ...part, name: "edited", version: 2 }),
      adjustStock: vi.fn().mockResolvedValue({ ...part, quantity: 5, version: 2 }),
    };
    render(<InventoryPage api={api} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "new part" } });
    fireEvent.change(screen.getByLabelText("收纳盒 ID"), { target: { value: "box-1" } });
    fireEvent.change(screen.getByLabelText("盒位"), { target: { value: "A1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.createPart).toHaveBeenCalledWith(expect.objectContaining({ name: "new part", box_id: "box-1", slot: "A1", quantity: 0 })));

    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
    expect(screen.getByLabelText("数量")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.updatePart).toHaveBeenCalledWith("part-1", 1, expect.objectContaining({ name: "edited", quantity: 3 })));

    fireEvent.change(screen.getByLabelText("edited调整数量"), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "调整数量" })[0]);
    await waitFor(() => expect(api.adjustStock).toHaveBeenCalledWith("part-1", 2, "手工调整"));
  });

  it("normalizes nullable metadata and exposes every editable field", async () => {
    const nullablePart = {
      id: "part-null", name: "capacitor", category: null, package: null, manufacturer: null,
      mpn: null, lcsc_code: null, quantity: 0, box_id: "box-1", slot: "A0", note: null, version: 1,
    };
    const api = {
      listParts: vi.fn().mockResolvedValue([nullablePart]),
      createPart: vi.fn(), updatePart: vi.fn().mockResolvedValue({ ...nullablePart, name: "edited", version: 2 }),
      adjustStock: vi.fn(),
    };
    render(<InventoryPage api={api} />);
    await screen.findByText("capacitor");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    for (const label of ["名称", "分类", "封装", "制造商", "MPN", "LCSC", "备注", "收纳盒 ID", "盒位"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("分类")).toHaveValue("");
    expect(screen.getByLabelText("备注")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("制造商"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "保存器件" }));
    await waitFor(() => expect(api.updatePart).toHaveBeenCalledWith("part-null", 1, expect.objectContaining({ manufacturer: "Acme", category: "" })));
  });
});
