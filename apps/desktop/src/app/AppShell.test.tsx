import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { App } from "./App";
import { AppShell, usePageActions } from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  it("collapses navigation without persistence and resets after remount", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const { unmount } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "折叠导航" }));
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-nav", "collapsed");
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "库存" })).toBeInTheDocument();

    unmount();
    render(<App />);
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-nav", "expanded");
    setItem.mockRestore();
  });

  it("shows one route title in the page toolbar", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "BOM" }));

    expect(screen.getByRole("toolbar", { name: "BOM 分析工具栏" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "BOM 分析" })).toHaveLength(1);
  });

  it("cleans page actions when a route is replaced", () => {
    function ActionPage() {
      usePageActions(<button type="button">页面操作</button>);
      return <Link to="/plain">前往普通页</Link>;
    }

    render(
      <MemoryRouter initialEntries={["/actions"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/actions" element={<ActionPage />} />
            <Route path="/plain" element={<p>普通页</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "页面操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "前往普通页" }));
    expect(screen.queryByRole("button", { name: "页面操作" })).not.toBeInTheDocument();
  });
});
