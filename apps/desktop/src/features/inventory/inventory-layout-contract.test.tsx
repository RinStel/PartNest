import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { InventoryPage } from "./InventoryPage";
import { BoxesPage } from "../boxes/BoxesPage";

afterEach(cleanup);

describe("inventory and box compact layout contract", () => {
  it("keeps the 1280x800 workspaces inside explicit overflow owners", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const inventoryApi = { listParts: vi.fn().mockResolvedValue([]), createPart: vi.fn(), updatePart: vi.fn(), adjustStock: vi.fn() };
    render(<MemoryRouter><InventoryPage api={inventoryApi} /></MemoryRouter>);
    expect(document.documentElement.clientWidth).toBeLessThanOrEqual(1280);
    expect(screen.getByRole("table", { name: "器件列表" }).parentElement).toHaveClass("pn-table-wrap");
    cleanup();
    const boxesApi = { listBoxes: vi.fn().mockResolvedValue([]), listParts: vi.fn().mockResolvedValue([]), createBox: vi.fn(), resizeBox: vi.fn() };
    render(<MemoryRouter><BoxesPage api={boxesApi} /></MemoryRouter>);
    expect(document.querySelector(".boxes-page")).toBeInTheDocument();
    expect(document.querySelector(".box-grid")).toBeNull();
  });
});
