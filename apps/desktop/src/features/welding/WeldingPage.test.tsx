import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WeldingPage, type WeldingApi } from "./WeldingPage";
import type { Part, ResolvedBomSelection } from "../../app/tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

afterEach(cleanup);

const part = (overrides: Partial<Part> = {}): Part => ({
  id: "part-1", name: "10k", category: "resistor", package: "0603", manufacturer: "Acme", mpn: "R-10K",
  lcsc_code: "C1", quantity: 8, box_id: 1, slot: "A0", note: "", version: 1, ...overrides,
});

const session = {
  session_id: "session-1", bom_file_id: "file-1", original_name: "board.html", display_name: "board",
  sha256: "hash", cache_name: "hash.html", cache_path: "C:\\Users\\test\\AppData\\Roaming\\PartNest\\interactive-bom-cache\\hash.html", token: "token-1",
  normalized: {
    source_name: "board.html",
    groups: [{ component_key: "C1", name: "10k", value: "10k", package: "0603", manufacturer: "Acme", mpn: "R-10K", lcsc_code: "C1", quantity: 3,
      designators: ["R1", "R2", "R3"],
      placements: [
        { designator: "R1", side: "top", component_key: "C1" },
        { designator: "R2", side: "top", component_key: "C1" },
        { designator: "R3", side: "bottom", component_key: "C1" },
      ], extra_fields: {} }],
  },
};

function makeApi(overrides: Partial<WeldingApi> = {}): WeldingApi {
  return {
    restoreActiveInteractiveBom: vi.fn().mockResolvedValue(session),
    resolveBomSelection: vi.fn().mockResolvedValue({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1", "R2"] }),
    listParts: vi.fn().mockResolvedValue([part()]),
    confirmTake: vi.fn().mockResolvedValue({ movement_id: "move-1", session_id: "session-1", component_key: "C1", side: "top", part_id: "part-1", take_quantity: 2, required_quantity: 2, consumed_quantity: 2, taken_quantity: 2, status: "taken", part_version: 2 }),
    getWeldingProgress: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function selectInBom(designators: string[], source?: MessageEventSource | null) {
  const frame = screen.getByTitle("交互式 BOM");
  window.dispatchEvent(new MessageEvent("message", { source: source ?? (frame as HTMLIFrameElement).contentWindow, data: { type: "partnest:bom-selection", token: "token-1", designators } }));
}

describe("WeldingPage", () => {
  it("shows a visible restore error and retries loading the workspace", async () => {
    const restore = vi.fn()
      .mockRejectedValueOnce(new Error("缓存 BOM 已损坏"))
      .mockResolvedValueOnce(session);
    const api = makeApi({ restoreActiveInteractiveBom: restore });
    render(<WeldingPage api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("缓存 BOM 已损坏");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByTitle("交互式 BOM");
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("keeps the empty state when no active BOM is restored", async () => {
    const api = makeApi({ restoreActiveInteractiveBom: vi.fn().mockResolvedValue(null) });
    render(<WeldingPage api={api} />);

    expect(await screen.findByText("暂无活动 BOM")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the light BOM canvas inside the dark 65/35 workspace", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.closest("[data-bom-canvas]")).toHaveClass("bom-canvas-light");
    expect(screen.getByTestId("welding-layout")).toHaveAttribute("data-split", "65-35");
  });

  it("shows the active BOM context and side progress summary", async () => {
    const api = makeApi({
      getWeldingProgress: vi.fn().mockResolvedValue([{ session_id: "session-1", component_key: "C1", side: "top", part_id: "part-1", required_quantity: 2, consumed_quantity: 1, taken_quantity: 1, status: "partial" }]),
    });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    expect(screen.getByRole("heading", { name: "焊接工作台" })).toBeVisible();
    expect(screen.getByText("board")).toBeVisible();
    selectInBom(["R1", "R2"]);
    expect(await screen.findByText("顶层 · 部分取用")).toBeVisible();
  });

  it("shows the full BOM in a collapsible tray and highlights the active group", async () => {
    const extraGroup = { ...session.normalized.groups[0], component_key: "C2", name: "1k", value: "1k", designators: ["R4"], placements: [{ designator: "R4", side: "top", component_key: "C2" }] };
    const api = makeApi({ restoreActiveInteractiveBom: vi.fn().mockResolvedValue({ ...session, normalized: { ...session.normalized, groups: [...session.normalized.groups, extraGroup] } }) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    expect(screen.getByRole("region", { name: "器件列表" })).toBeInTheDocument();
    expect(screen.getByText("1k")).toBeInTheDocument();
    selectInBom(["R1", "R2"]);
    await screen.findByText("当前选择：R1, R2");
    expect(screen.getByTestId("tray-row-C1")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: "收起器件列表" }));
    expect(screen.getByRole("region", { name: "器件列表" })).toHaveAttribute("data-collapsed", "true");
  });

  it("keeps an empty current side informational and never submits a take", async () => {
    const topOnlySession = {
      ...session,
      normalized: {
        ...session.normalized,
        groups: [{ ...session.normalized.groups[0], quantity: 2, designators: ["R1", "R2"], placements: [
          { designator: "R1", side: "top" as const, component_key: "C1" },
          { designator: "R2", side: "top" as const, component_key: "C1" },
        ] }],
      },
    };
    const api = makeApi({ restoreActiveInteractiveBom: vi.fn().mockResolvedValue(topOnlySession) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    await screen.findByText("当前选择：R1, R2");

    fireEvent.click(screen.getByRole("tab", { name: "底层" }));
    expect(screen.getByText("当前面无器件", { selector: ".welding-empty-side" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认取用/ })).not.toBeInTheDocument();
    expect(api.confirmTake).not.toHaveBeenCalled();
  });

  it("switches board side tabs with the keyboard", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");

    const tablist = screen.getByRole("tablist", { name: "板面" });
    const topTab = screen.getByRole("tab", { name: "顶层" });
    const bottomTab = screen.getByRole("tab", { name: "底层" });
    topTab.focus();
    expect(topTab).toHaveAttribute("tabindex", "0");
    expect(bottomTab).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(bottomTab).toHaveAttribute("aria-selected", "true");
    expect(bottomTab).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(topTab).toHaveAttribute("aria-selected", "true");
    expect(topTab).toHaveFocus();
  });

  it("uses the tray as a selection fallback without injecting styles into the BOM frame", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    const trayRow = screen.getByTestId("tray-row-C1");
    expect(screen.getByRole("table", { name: "BOM 器件" })).toHaveAttribute("data-scroll-container", "true");
    expect(trayRow.tagName).toBe("DIV");
    fireEvent.click(trayRow);
    await waitFor(() => expect(api.resolveBomSelection).toHaveBeenCalledWith("token-1", ["R1", "R2"]));
    expect(frame).not.toHaveAttribute("srcdoc");
    expect(frame).not.toHaveAttribute("style");
    expect(frame.children).toHaveLength(0);
  });

  it("resolves a single designator selection from the BOM bridge", async () => {
    const api = makeApi({ resolveBomSelection: vi.fn().mockResolvedValue({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1"] }) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1"]);
    await waitFor(() => expect(api.resolveBomSelection).toHaveBeenCalledWith("token-1", ["R1"]));
    expect(await screen.findByText("当前选择：R1")).toBeInTheDocument();
  });

  it("records the selected designator subset as the BOM quantity", async () => {
    const api = makeApi({ resolveBomSelection: vi.fn().mockResolvedValue({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1"] }) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1"]);
    fireEvent.click(await screen.findByRole("button", { name: /确认取用/ }));
    await waitFor(() => expect(api.confirmTake).toHaveBeenCalledWith(expect.objectContaining({ designators: ["R1"], bom_quantity: 1 })));
  });

  it("resolves a BOM selection without confirming or mutating stock", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    await waitFor(() => expect(api.resolveBomSelection).toHaveBeenCalledWith("token-1", ["R1", "R2"]));
    expect(api.confirmTake).not.toHaveBeenCalled();
    expect(screen.getByText("R1, R2")).toBeInTheDocument();
  });

  it("converts the raw cached path through the production Tauri adapter", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    expect(convertFileSrc).toHaveBeenCalledWith(session.cache_path);
    expect(frame).toHaveAttribute("src", `asset://localhost/${encodeURIComponent(session.cache_path)}`);
  });

  it("uses the edited quantity only after explicit confirmation", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    const input = await screen.findByLabelText("取用数量");
    fireEvent.change(input, { target: { value: "4" } });
    expect(api.confirmTake).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认取用（−4）" }));
    await waitFor(() => expect(api.confirmTake).toHaveBeenCalledWith(expect.objectContaining({ take_quantity: 4, bom_quantity: 2, side: "top", expected_part_version: 1 })));
  });

  it("groups the selected part, stock and confirmation into a compact take card", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    const panel = await screen.findByRole("region", { name: "取用面板" });
    expect(panel).toHaveClass("take-panel");
    expect(screen.getByRole("heading", { name: "取用信息" })).toBeVisible();
    expect(panel.querySelector("dl")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认取用（−2）" })).toBeVisible();
  });

  it("keeps bottom pending after a top confirmation", async () => {
    const api = makeApi({
      getWeldingProgress: vi.fn().mockResolvedValue([{ session_id: "session-1", component_key: "C1", side: "top", part_id: "part-1", required_quantity: 2, consumed_quantity: 2, taken_quantity: 2, status: "taken" }]),
    });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    fireEvent.click(await screen.findByRole("button", { name: /确认取用/ }));
    await waitFor(() => expect(api.getWeldingProgress).toHaveBeenCalledWith("session-1"));
    fireEvent.click(screen.getByRole("tab", { name: "全部" }));
    expect(screen.getByText("底层：待取用")).toBeInTheDocument();
  });

  it("preserves edited input after insufficient stock failure", async () => {
    const api = makeApi({ confirmTake: vi.fn().mockRejectedValue(new Error("库存不足")) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    const input = await screen.findByLabelText("取用数量");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "确认取用（−99）" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("库存不足"));
    expect(input).toHaveValue(99);
  });

  it("resets column widths after unmount and remount", async () => {
    const api = makeApi();
    const view = render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    await screen.findByText("R1, R2");
    const separator = screen.getByRole("separator", { name: "调整器件列宽" });
    expect(screen.getByTestId("component-column")).toHaveStyle({ width: "180px" });
    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);
    expect(screen.getByTestId("component-column")).toHaveStyle({ width: "330px" });
    expect(screen.getByTestId("component-cell")).toHaveStyle({ width: "330px" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "322");
    view.unmount();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    await screen.findByText("R1, R2");
    expect(screen.getByTestId("component-column")).toHaveStyle({ width: "180px" });
  });

  it("rejects messages from a different window before resolving", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    const foreign = document.createElement("iframe");
    document.body.appendChild(foreign);
    selectInBom(["R1", "R2"], foreign.contentWindow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.resolveBomSelection).not.toHaveBeenCalled();
    frame.remove(); foreign.remove();
  });

  it("rejects invalid message shapes before resolving", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    window.dispatchEvent(new MessageEvent("message", { source: (frame as HTMLIFrameElement).contentWindow, data: { type: "partnest:bom-selection", token: "token-1", designators: "R1" } }));
    window.dispatchEvent(new MessageEvent("message", { source: (frame as HTMLIFrameElement).contentWindow, data: { type: "other", token: "token-1", designators: ["R1"] } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.resolveBomSelection).not.toHaveBeenCalled();
  });

  it("ignores a stale bridge response after a newer selection", async () => {
    const pending: Array<(selection: ResolvedBomSelection) => void> = [];
    const api = makeApi({ resolveBomSelection: vi.fn((_token: string, designators: string[]) => new Promise<ResolvedBomSelection>((resolve) => pending.push(() => resolve({ session_id: "session-1", component_key: "C1", side: "top", designators })))) });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    selectInBom(["R1"]);
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0]({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1", "R2"] });
    pending[1]({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1"] });
    expect(await screen.findByText("当前选择：R1")).toBeInTheDocument();
    expect(screen.queryByText("当前选择：R1, R2")).not.toBeInTheDocument();
  });

  it("ignores an in-flight bridge response after unmount", async () => {
    let resolveSelection: ((selection: ResolvedBomSelection) => void) | undefined;
    const api = makeApi({ resolveBomSelection: vi.fn(() => new Promise<ResolvedBomSelection>((resolve) => { resolveSelection = resolve; })) });
    const view = render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1"]);
    await waitFor(() => expect(api.resolveBomSelection).toHaveBeenCalled());
    view.unmount();
    expect(() => resolveSelection?.({ session_id: "session-1", component_key: "C1", side: "top", designators: ["R1"] })).not.toThrow();
  });

  it("uses a scripts-only sandbox for the untrusted BOM", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    const frame = await screen.findByTitle("交互式 BOM");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("does not silently use a same-named part when an authoritative LCSC is unmatched", async () => {
    const api = makeApi({
      restoreActiveInteractiveBom: vi.fn().mockResolvedValue({
        ...session,
        normalized: {
          ...session.normalized,
          groups: [{ ...session.normalized.groups[0], lcsc_code: "C-MISSING" }],
        },
      }),
    });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    expect(await screen.findByLabelText("选择器件")).toHaveValue("");
    expect(screen.getByRole("button", { name: /确认取用/ })).toBeDisabled();
    expect(api.confirmTake).not.toHaveBeenCalled();
  });

  it("drops the BOM selection when switching to the other board side", async () => {
    const api = makeApi();
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);
    await screen.findByText("当前选择：R1, R2");

    fireEvent.click(screen.getByRole("tab", { name: "底层" }));
    expect(screen.getByText("请在 BOM 中选择器件")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认取用/ })).not.toBeInTheDocument();
    expect(api.confirmTake).not.toHaveBeenCalled();

    // 底层仍可取用，但必须重新选择位号。
    fireEvent.click(screen.getByTestId("tray-row-C1"));
    await waitFor(() => expect(api.resolveBomSelection).toHaveBeenLastCalledWith("token-1", ["R3"]));
  });

  it("blocks a take whose selected designators were all consumed already", async () => {
    const api = makeApi({
      getWeldingProgress: vi.fn().mockResolvedValue([{
        session_id: "session-1", component_key: "C1", side: "top", part_id: "part-1",
        required_quantity: 2, consumed_quantity: 2, taken_quantity: 2,
        confirmed_designators: ["R1", "R2"], status: "taken",
      }]),
    });
    render(<WeldingPage api={api} />);
    await screen.findByTitle("交互式 BOM");
    selectInBom(["R1", "R2"]);

    expect(await screen.findByText("所选位号在当前板面均已取用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认取用/ })).toBeDisabled();
    expect(api.confirmTake).not.toHaveBeenCalled();
  });
});
