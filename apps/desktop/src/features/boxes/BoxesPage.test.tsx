import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoxesPage } from "./BoxesPage";

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
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("目标规格包含不了已占用盒位 A9")).toBeVisible();
  });
});
