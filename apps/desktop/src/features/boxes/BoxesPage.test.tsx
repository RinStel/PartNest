import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BoxesPage } from "./BoxesPage";

afterEach(cleanup);
const box = { id: "box-1", name: "抽屉盒", rows: 2, cols: 4, occupied_slots: ["A0"] };
const part = { id: "part-1", name: "10k", category: "resistor", package: "0603", manufacturer: "", mpn: "", lcsc_code: "", quantity: 8, box_id: "box-1", slot: "A0", note: "", version: 1 };

describe("BoxesPage", () => {
  it("splits box list and slot workspace and maps occupied slot details", async () => {
    const api = { listBoxes: vi.fn().mockResolvedValue([box]), listParts: vi.fn().mockResolvedValue([part]), createBox: vi.fn(), resizeBox: vi.fn() };
    render(<MemoryRouter><BoxesPage api={api} /></MemoryRouter>);
    expect((await screen.findAllByText("抽屉盒")).length).toBeGreaterThan(0);
    expect(screen.getByRole("complementary", { name: "收纳盒列表" })).toBeInTheDocument();
    expect(screen.getByLabelText("A0 已占用 10k 数量 8")).toBeInTheDocument();
    expect(screen.getByLabelText("A1 空闲")).toBeInTheDocument();
  });

  it("opens a dialog for create and retains backend resize occupancy errors", async () => {
    const api = { listBoxes: vi.fn().mockResolvedValue([box]), listParts: vi.fn().mockResolvedValue([]), createBox: vi.fn(), resizeBox: vi.fn().mockRejectedValue({ message: "目标规格包含不了已占用盒位 A0" }) };
    render(<MemoryRouter><BoxesPage api={api} /></MemoryRouter>);
    await screen.findAllByText("抽屉盒");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("dialog", { name: "编辑收纳盒" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("列"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("目标规格包含不了已占用盒位 A0")).toBeVisible();
    expect(api.resizeBox).toHaveBeenCalledWith("box-1", 2, 3);
  });

  it("validates maximum columns before calling backend", async () => {
    const api = { listBoxes: vi.fn().mockResolvedValue([box]), listParts: vi.fn().mockResolvedValue([]), createBox: vi.fn(), resizeBox: vi.fn() };
    render(<MemoryRouter><BoxesPage api={api} /></MemoryRouter>);
    await screen.findAllByText("抽屉盒");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("列"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("列数不能超过 100")).toBeVisible();
    expect(api.resizeBox).not.toHaveBeenCalled();
  });
});
