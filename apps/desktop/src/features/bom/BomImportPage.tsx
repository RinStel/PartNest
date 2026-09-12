import { FieldMappingDialog } from "./FieldMappingDialog";
import { BomAnalysisTable } from "./BomAnalysisTable";
import { useBomImport, type BomImportApi } from "./useBomImport";
import { useMemo } from "react";
import { PageToolbar } from "../../components/ui/PageToolbar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { usePageActions } from "../../app/AppShell";
import "../../styles/bom.css";

export type { BomImportApi };

export function BomImportPage({ api, pickFile, pickCompanionFile }: { api?: BomImportApi; pickFile?: () => Promise<string | null>; pickCompanionFile?: () => Promise<string | null> }) {
  const state = useBomImport({ api, pickFile, pickCompanionFile });
  const fileName = state.path.split(/[\\/]/).pop() || "";
  const companionFileName = state.companionPath.split(/[\\/]/).pop() || "";
  const summary = useMemo(() => ({
    groups: state.rows.length,
    designators: state.bom?.groups.reduce((total, group) => total + (group.designators?.length ?? 0), 0) ?? 0,
    shortages: state.rows.filter((row) => row.shortage > 0).length,
    unmatched: state.rows.filter((row) => row.status === "none").length,
  }), [state.bom, state.rows]);
  const isInteractive = state.path.toLowerCase().endsWith(".html");
  const toolbarActions = useMemo(() => <>
    <label className="bom-toolbar__remark">备注名<input className="pn-control" aria-label="BOM备注名" value={state.displayName} onChange={(event) => state.setDisplayName(event.target.value)} /></label>
    {fileName && <span className="bom-toolbar__file" title={state.path}>{fileName}</span>}
    <button className="pn-button pn-button--secondary" type="button" onClick={() => void state.chooseFile()}>选择文件</button>
    {isInteractive && <><button className="pn-button pn-button--ghost" type="button" onClick={() => void state.chooseCompanionFile()}>配套 CSV</button>{companionFileName && <span className="bom-toolbar__file" title={state.companionPath}>{companionFileName}</span>}</>}
    {isInteractive && state.status === "ready" && <button className="pn-button pn-button--primary" type="button" onClick={() => void state.activate()}>{state.activated ? "重新设为活动 BOM" : "设为活动 BOM"}</button>}
    {state.status === "loading" && <StatusBadge tone="active">解析中</StatusBadge>}
    {state.status === "ready" && <StatusBadge tone={state.activated ? "success" : "neutral"}>{state.activated ? "已设为活动 BOM" : "仅完成分析"}</StatusBadge>}
  </>, [companionFileName, fileName, isInteractive, state.activate, state.activated, state.companionPath, state.chooseCompanionFile, state.displayName, state.path, state.status, state.chooseFile]);
  const inShell = usePageActions(toolbarActions);
  return <section className={state.status === "idle" ? "bom-empty-state" : "bom-workspace"} aria-label="BOM 分析">
    {!inShell && <PageToolbar title="BOM 操作" actions={toolbarActions} />}
    {state.status === "idle" && <div className="bom-empty-state__content"><strong>未加载 BOM</strong><span>选择 HTML、CSV 或 XLSX 后开始缺料分析</span></div>}
    {state.status !== "idle" && <nav className="bom-progress" aria-label="BOM 导入流程">
      <span data-state="complete"><b>1</b>选择文件</span>
      <span data-state={state.status === "needsMapping" ? "active" : state.status === "loading" ? "active" : "complete"}><b>2</b>解析与映射</span>
      <span data-state={state.status === "ready" ? "active" : "pending"}><b>3</b>分析结果</span>
      {isInteractive && <span data-state={state.activated ? "complete" : "pending"}><b>4</b>设为活动 BOM</span>}
    </nav>}
    {isInteractive && state.status === "ready" && !state.activated && <p className="bom-hint" role="status">分析不会改变焊接工作台的活动 BOM，确认后点击「设为活动 BOM」。</p>}
    {state.error && <div className="bom-error" role="alert"><span>{state.error}</span>{state.path && state.status === "error" && <button className="pn-button pn-button--ghost" type="button" onClick={() => void state.inspect(state.path)}>重新解析</button>}</div>}
    {state.status === "needsMapping" && <FieldMappingDialog headers={state.headers} mapping={state.mapping} onChange={state.setMapping} onConfirm={() => void state.submitMapping()} onCancel={state.cancelMapping} />}
    {state.status === "ready" && <>
      <section className="bom-summary" aria-label="BOM 分析汇总">
        <div><span>器件组</span><strong>{summary.groups} 个器件组</strong></div>
        <div><span>位号</span><strong>{summary.designators} 个位号</strong></div>
        <div data-tone={summary.shortages > 0 ? "danger" : "success"}><span>缺料组</span><strong>{summary.shortages} 个缺料组</strong></div>
        <div data-tone={summary.unmatched > 0 ? "warning" : "success"}><span>未匹配组</span><strong>{summary.unmatched} 个未匹配组</strong></div>
      </section>
      <BomAnalysisTable rows={state.rows} onConfirmMatch={state.confirmMatch} />
    </>}
  </section>;
}
