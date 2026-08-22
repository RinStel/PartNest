import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovementsPage } from "./MovementsPage";

afterEach(cleanup);

describe("MovementsPage", () => {
  it("shows newest-first audited stock changes and only offers eligible reversal", async () => {
    const api = {
      listMovements: vi.fn().mockResolvedValue([
        { id: "m-2", part_id: "part-1", component: "10k resistor", part_name: "10k resistor", component_key: "R1", side: "top", movement_type: "consume", delta: -2, quantity: -2, before_quantity: 12, after_quantity: 10, reason: "welding take", bom_display_name: "Board note", session_id: "session-1", created_at: "2026-01-02T00:00:00Z", reverses_movement_id: null, reversible: true },
        { id: "m-inactive", part_id: "part-1", component: "10k resistor", part_name: "10k resistor", component_key: "R1", side: "top", movement_type: "consume", delta: -1, quantity: -1, before_quantity: 13, after_quantity: 12, reason: "legacy take", bom_display_name: "Old board", session_id: "inactive-session", created_at: "2026-01-03T00:00:00Z", reverses_movement_id: null, reversible: false },
        { id: "m-malformed", part_id: "part-1", component: "10k resistor", part_name: "10k resistor", component_key: "", side: null, movement_type: "consume", delta: -1, quantity: -1, before_quantity: 14, after_quantity: 13, reason: "legacy malformed", bom_display_name: null, session_id: "session-1", created_at: "2026-01-02T12:00:00Z", reverses_movement_id: null, reversible: false },
        { id: "m-1", part_id: "part-1", component: "10k resistor", part_name: "10k resistor", component_key: null, side: null, movement_type: "adjust", delta: 12, quantity: 12, before_quantity: 0, after_quantity: 12, reason: "restock", bom_display_name: null, session_id: null, created_at: "2026-01-01T00:00:00Z", reverses_movement_id: null, reversible: false },
      ]),
      reverseTake: vi.fn().mockResolvedValue(undefined),
    };
    render(<MovementsPage api={api} />);

    expect((await screen.findAllByText("10k resistor")).length).toBe(4);
    expect(screen.getByText("Board note")).toBeInTheDocument();
    expect(screen.getByText("welding take")).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("-2");
    expect(screen.getByRole("button", { name: "撤销取用" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "撤销取用" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "撤销取用" }));
    await waitFor(() => expect(api.reverseTake).toHaveBeenCalledWith("m-2"));
    expect(api.listMovements).toHaveBeenCalledTimes(2);
  });
});
