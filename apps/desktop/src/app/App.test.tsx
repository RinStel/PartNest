import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("shows the six primary destinations", () => {
    render(<App />);
    for (const label of ["库存", "收纳盒", "BOM", "焊接工作台", "库存流水", "设置"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("mounts the BOM analysis page at the BOM destination", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("link", { name: "BOM" })[0]);
    expect(screen.getByRole("heading", { name: "BOM 分析" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "BOM 分析工具栏" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "BOM 分析" })).toHaveLength(1);
  });

  it("mounts the welding workspace at the welding destination", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("link", { name: "焊接工作台" })[0]);
    expect(screen.getByRole("heading", { name: "焊接工作台" })).toBeInTheDocument();
  });

  it("keeps the shell visible with a fallback title for unknown routes", () => {
    window.history.pushState({}, "", "/unknown-route");
    render(<App />);
    expect(screen.getByRole("toolbar", { name: "PartNest工具栏" })).toBeInTheDocument();
  });
});
