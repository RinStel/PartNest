/// <reference types="vite/client" />
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfigSource from "../../../vite.config.ts?raw";
import tauriConfigSource from "../../../src-tauri/tauri.conf.json?raw";
import { Dialog, Drawer } from "./Overlay";
import { StatusBadge } from "./StatusBadge";

afterEach(() => {
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

  it("uses the compact control contract", () => {
    render(<StatusBadge tone="warning">缺料</StatusBadge>);
    expect(screen.getByText("缺料")).toHaveAttribute("data-tone", "warning");
  });

  it("keeps Vite and Tauri on the exact development origin", () => {
    const viteConfig = viteConfigSource;
    const tauriConfig = JSON.parse(tauriConfigSource) as {
      build: { devUrl: string };
    };

    expect(viteConfig).toMatch(/host:\s*["']127\.0\.0\.1["']/);
    expect(viteConfig).toMatch(/port:\s*1420/);
    expect(viteConfig).toMatch(/strictPort:\s*true/);
    expect(tauriConfig.build.devUrl).toBe("http://127.0.0.1:1420");
  });
});
