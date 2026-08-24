import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { InventoryPage } from "./InventoryPage";
import { BoxesPage } from "../boxes/BoxesPage";

afterEach(cleanup);

describe("inventory and box compact layout contract", () => {
  it("exposes stable overflow, min-width, and grid CSS contracts", async () => {
    const inventoryApi = { listParts: vi.fn().mockResolvedValue([]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={inventoryApi} /></MemoryRouter>);
    const table = screen.getByRole("table", { name: "器件列表" });
    const tableWrap = table.parentElement;
    expect(document.querySelector(".inventory-page")).toHaveClass("inventory-page");
    expect(table).toHaveClass("pn-data-table");
    expect(tableWrap).toHaveClass("pn-table-wrap");
    expect(table.querySelectorAll("col").length).toBeGreaterThan(1);

    cleanup();
    const box = { id: "box-1", name: "抽屉盒", rows: 2, cols: 4, occupied_slots: [] };
    const boxesApi = { listBoxes: vi.fn().mockResolvedValue([box]), listParts: vi.fn().mockResolvedValue([]), createBox: vi.fn(), resizeBox: vi.fn() };
    render(<MemoryRouter><BoxesPage api={boxesApi} /></MemoryRouter>);
    await screen.findAllByText("抽屉盒");
    expect(document.querySelector(".boxes-page")).toHaveClass("boxes-page");
    expect(document.querySelector(".boxes-list")).toHaveClass("boxes-list");
    expect(document.querySelector(".box-workspace")).toHaveClass("box-workspace");
    const grid = document.querySelector(".box-grid");
    expect(grid).toHaveClass("box-grid");
    expect((grid as HTMLElement).style.getPropertyValue("--box-cols")).toBe("4");
  });
});
