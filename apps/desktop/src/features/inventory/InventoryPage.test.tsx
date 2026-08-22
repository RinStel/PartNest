import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "./InventoryPage";

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
});
