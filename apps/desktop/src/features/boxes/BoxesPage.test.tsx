import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxesPage } from "./BoxesPage";

afterEach(cleanup);

describe("BoxesPage", () => {
  it("keeps the occupied slot when resize would remove it", async () => {
    const apiRejectingResize = {
      listBoxes: vi.fn().mockResolvedValue([
        { id: "box-1", name: "抽屉盒", rows: 10, cols: 10, occupied_slots: ["A9"] },
      ]),
      createBox: vi.fn(),
      resizeBox: vi.fn().mockRejectedValue({ message: "目标规格包含不了已占用盒位 A9" }),
    };
    render(<BoxesPage api={apiRejectingResize} />);
    await screen.findByText("抽屉盒");
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);

    expect(await screen.findByText("目标规格包含不了已占用盒位 A9")).toBeVisible();
  });

  it("shows a validation error before resizing beyond one hundred columns", async () => {
    const api = {
      listBoxes: vi.fn().mockResolvedValue([
        { id: "box-1", name: "抽屉盒", rows: 2, cols: 4, occupied_slots: [] },
      ]),
      createBox: vi.fn(),
      resizeBox: vi.fn(),
    };
    render(<BoxesPage api={api} />);
    await screen.findByText("抽屉盒");
    fireEvent.change(screen.getAllByLabelText("列")[1], { target: { value: "101" } });
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0]);

    expect(await screen.findByText("列数不能超过 100")).toBeVisible();
    expect(api.resizeBox).not.toHaveBeenCalled();
  });
});
