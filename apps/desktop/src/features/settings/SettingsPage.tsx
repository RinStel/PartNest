import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { desktopApi, errorMessage, type DesktopApi } from "../../app/tauri";

export type SettingsApi = Pick<DesktopApi, "createBackup" | "restoreBackup">;

export async function pickBackupFile(): Promise<string | null> {
  const selected = await open({ multiple: false, filters: [{ name: "PartNest 备份", extensions: ["db"] }] });
  return typeof selected === "string" ? selected : null;
}
export function SettingsPage({ api = desktopApi, pickFile = pickBackupFile }: { api?: SettingsApi; pickFile?: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function create() {
    setBusy(true); setError(""); setNotice("");
    try {
      const path = await api.createBackup();
      setNotice(`备份已创建：${path}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  async function restore() {
    const path = await pickFile();
    if (!path) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.restoreBackup(path);
      setNotice("已恢复备份，请重新打开需要刷新的页面");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="settings-title">
    <h2 id="settings-title">设置</h2>
    <section aria-labelledby="backup-title">
      <h3 id="backup-title">数据库备份</h3>
      <p>备份包含当前库存、流水和焊接进度。</p>
      <button type="button" disabled={busy} onClick={() => void create()}>立即备份</button>
      <button type="button" disabled={busy} onClick={() => void restore()}>选择备份恢复</button>
      <p>恢复会覆盖当前数据库，请选择明确的备份文件。</p>
    </section>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
