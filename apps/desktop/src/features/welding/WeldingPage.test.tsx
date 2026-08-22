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
  lcsc_code: "C1", quantity: 8, box_id: "box-1", slot: "A0", note: "", version: 1, ...overrides,
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
});
