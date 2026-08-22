import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("shows the six primary destinations", () => {
    render(<App />);
    for (const label of ["库存", "收纳盒", "BOM", "焊接工作台", "库存流水", "设置"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
