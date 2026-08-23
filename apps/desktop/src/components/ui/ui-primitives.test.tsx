/// <reference types="vite/client" />
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../../../vite.config";
import tauriConfigSource from "../../../src-tauri/tauri.conf.json?raw";
import { Dialog, Drawer } from "./Overlay";
import { StatusBadge } from "./StatusBadge";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("compact UI primitives", () => {
  it("closes a drawer with Escape and restores focus after it closes", () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "打开编辑器";
    document.body.appendChild(trigger);
    trigger.focus();

    const view = render(
      <Drawer open title="编辑器件" onRequestClose={onClose}>
        <button>保存</button>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "编辑器件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "编辑器件" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(
      <Drawer open={false} title="编辑器件" onRequestClose={onClose}>
        <button>保存</button>
      </Drawer>,
    );
    expect(trigger).toHaveFocus();
  });

  it("does not close a dirty dialog until the discard confirmation resolves true", async () => {
    const onClose = vi.fn();
    let resolveConfirmation!: (value: boolean) => void;
    const confirmDiscard = vi.fn(
      () => new Promise<boolean>((resolvePromise) => { resolveConfirmation = resolvePromise; }),
    );
    render(
      <Dialog open dirty title="编辑器件" onRequestClose={onClose} confirmDiscard={confirmDiscard}>
        <input aria-label="名称" />
      </Dialog>,
    );

    fireEvent.keyDown(screen.getByRole("dialog", { name: "编辑器件" }), { key: "Escape" });
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    resolveConfirmation(false);
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "编辑器件" }), { key: "Escape" });
    resolveConfirmation(true);
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores a stale async discard result after an overlay is reopened", async () => {
    const onClose = vi.fn();
    let resolveConfirmation!: (value: boolean) => void;
    const confirmDiscard = vi.fn(() => new Promise<boolean>((resolvePromise) => { resolveConfirmation = resolvePromise; }));
    const view = render(
      <Drawer open dirty title="编辑器件" onRequestClose={onClose} confirmDiscard={confirmDiscard}>
        <input aria-label="名称" />
      </Drawer>,
    );

    fireEvent.keyDown(screen.getByRole("dialog", { name: "编辑器件" }), { key: "Escape" });
    view.rerender(<Drawer open={false} dirty title="编辑器件" onRequestClose={onClose} confirmDiscard={confirmDiscard}>内容</Drawer>);
    view.rerender(<Drawer open dirty title="编辑器件" onRequestClose={onClose} confirmDiscard={confirmDiscard}>内容</Drawer>);
    resolveConfirmation(true);
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not let a lower overlay close or restore focus while a higher overlay is open", () => {
    const lowerClose = vi.fn();
    const higherClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const view = render(
      <>
        <Drawer open title="底层抽屉" onRequestClose={lowerClose}><button>底层操作</button></Drawer>
        <Dialog open title="顶层对话框" onRequestClose={higherClose}><button>顶层操作</button></Dialog>
      </>,
    );
    const lower = screen.getByRole("dialog", { name: "底层抽屉" });
    const higher = screen.getByRole("dialog", { name: "顶层对话框" });
    expect(within(higher).getByRole("button", { name: "关闭" })).toHaveFocus();

    fireEvent.keyDown(lower, { key: "Escape" });
    expect(lowerClose).not.toHaveBeenCalled();
    expect(higherClose).not.toHaveBeenCalled();
    view.rerender(
      <>
        <Drawer open={false} title="底层抽屉" onRequestClose={lowerClose}><button>底层操作</button></Drawer>
        <Dialog open title="顶层对话框" onRequestClose={higherClose}><button>顶层操作</button></Dialog>
      </>,
    );
    expect(within(higher).getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("traps Tab and Shift+Tab inside the topmost overlay", () => {
    render(<Dialog open title="焦点测试" onRequestClose={vi.fn()}><button>第一个</button><button>第二个</button></Dialog>);
    const dialog = screen.getByRole("dialog", { name: "焦点测试" });
    const first = screen.getByRole("button", { name: "第一个" });
    const second = screen.getByRole("button", { name: "第二个" });
    second.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(second).toHaveFocus();
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  });

  it("focuses the overlay surface when no focusable child remains", () => {
    render(<Dialog open title="无焦点子节点" onRequestClose={vi.fn()}>静态内容</Dialog>);
    const dialog = screen.getByRole("dialog", { name: "无焦点子节点" });
    screen.getByRole("button", { name: "关闭" }).setAttribute("disabled", "true");
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
  });

  it("keeps a dirty overlay open when no discard confirmation is provided", () => {
    const onClose = vi.fn();
    render(<Dialog open dirty title="未确认" onRequestClose={onClose}>内容</Dialog>);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "未确认" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "未确认" })).toBeInTheDocument();
  });

  it("closes the topmost overlay from its backdrop only", () => {
    const lowerClose = vi.fn();
    const higherClose = vi.fn();
    const view = render(
      <>
        <Drawer open title="底层遮罩" onRequestClose={lowerClose}>内容</Drawer>
        <Dialog open title="顶层遮罩" onRequestClose={higherClose}>内容</Dialog>
      </>,
    );
    const lowerBackdrop = screen.getByRole("dialog", { name: "底层遮罩" }).parentElement!;
    const higherBackdrop = screen.getByRole("dialog", { name: "顶层遮罩" }).parentElement!;
    fireEvent.mouseDown(lowerBackdrop);
    expect(lowerClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(higherBackdrop);
    expect(higherClose).toHaveBeenCalledOnce();
    view.rerender(
      <>
        <Drawer open title="底层遮罩" onRequestClose={lowerClose}>内容</Drawer>
        <Dialog open={false} title="顶层遮罩" onRequestClose={higherClose}>内容</Dialog>
      </>,
    );
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "底层遮罩" }).parentElement!);
    expect(lowerClose).toHaveBeenCalledOnce();
  });

  it("cleans the overlay stack across StrictMode lifecycles", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "严格模式触发器";
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(<Dialog open title="严格模式" onRequestClose={onClose}>内容</Dialog>, { reactStrictMode: true });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "严格模式" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(<Dialog open={false} title="严格模式" onRequestClose={onClose}>内容</Dialog>);
    expect(trigger).toHaveFocus();
    view.unmount();
  });

  it("cleans references when an open StrictMode overlay genuinely unmounts", () => {
    const firstTrigger = document.createElement("button");
    document.body.appendChild(firstTrigger);
    firstTrigger.focus();
    const first = render(<Dialog open title="已卸载" onRequestClose={vi.fn()}>内容</Dialog>, { reactStrictMode: true });
    first.unmount();

    const nextTrigger = document.createElement("button");
    document.body.appendChild(nextTrigger);
    nextTrigger.focus();
    const next = render(<Dialog open title="下一层" onRequestClose={vi.fn()}>内容</Dialog>, { reactStrictMode: true });
    next.rerender(<Dialog open={false} title="下一层" onRequestClose={vi.fn()}>内容</Dialog>);
    expect(nextTrigger).toHaveFocus();
    next.unmount();
  });

  it("uses the compact control contract", () => {
    render(<StatusBadge tone="warning">缺料</StatusBadge>);
    expect(screen.getByText("缺料")).toHaveAttribute("data-tone", "warning");
  });

  it("keeps Vite and Tauri on the exact development origin", () => {
    const tauriConfig = JSON.parse(tauriConfigSource) as {
      build: { devUrl: string };
    };
    const server = viteConfig.server;

    expect(server).toBeDefined();
    expect(server?.host).toBe("127.0.0.1");
    expect(server?.port).toBe(1420);
    expect(server?.strictPort).toBe(true);
    expect(`http://${server?.host}:${server?.port}`).toBe(tauriConfig.build.devUrl);
  });
});
