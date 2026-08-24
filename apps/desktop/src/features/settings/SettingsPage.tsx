import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { desktopApi, errorMessage, type DesktopApi } from "../../app/tauri";
import { StatusBadge } from "../../components/ui/StatusBadge";

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

  return <section className="operations-page settings-page" aria-label="设置">
    <section className="settings-group" aria-labelledby="backup-title">
      <h2 id="backup-title">数据与备份</h2>
      <button type="button" disabled={busy} onClick={() => void create()}>立即备份</button>
      <button type="button" disabled={busy} onClick={() => void restore()}>选择备份恢复</button>
      <p className="settings-risk">恢复会覆盖当前数据。</p>
    </section>
    <section className="settings-group" aria-labelledby="interface-title">
      <h2 id="interface-title">界面</h2>
      <p className="settings-value"><span>主题</span><StatusBadge tone="active">深色主题</StatusBadge></p>
    </section>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
