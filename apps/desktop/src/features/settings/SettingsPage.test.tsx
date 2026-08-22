import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { pickBackupFile, SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage", () => {
  it("creates a backup and restores the explicitly selected file", async () => {
    const api = {
      createBackup: vi.fn().mockResolvedValue("C:/backups/partnest.db"),
      restoreBackup: vi.fn().mockResolvedValue(undefined),
    };
    const pickFile = vi.fn().mockResolvedValue("C:/backups/selected.db");
    render(<SettingsPage api={api} pickFile={pickFile} />);

    fireEvent.click(screen.getByRole("button", { name: "立即备份" }));
    await waitFor(() => expect(api.createBackup).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("备份已创建");

    fireEvent.click(screen.getByRole("button", { name: "选择备份恢复" }));
    await waitFor(() => expect(pickFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledWith("C:/backups/selected.db"));
    expect(screen.getByRole("status")).toHaveTextContent("已恢复备份");
  });

  it("configures the file picker for database backups and handles cancellation", async () => {
    vi.mocked(open).mockResolvedValueOnce("C:/backups/selected.db");
    await expect(pickBackupFile()).resolves.toBe("C:/backups/selected.db");
    expect(open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "PartNest 备份", extensions: ["db"] }],
    });

    vi.mocked(open).mockResolvedValueOnce(["C:/backups/ignored.db"]);
    await expect(pickBackupFile()).resolves.toBeNull();
  });
});
