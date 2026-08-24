import { FieldMappingDialog } from "./FieldMappingDialog";
import { BomAnalysisTable } from "./BomAnalysisTable";
import { useBomImport, type BomImportApi } from "./useBomImport";
import { useMemo } from "react";
import { PageToolbar } from "../../components/ui/PageToolbar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { usePageActions } from "../../app/AppShell";
import "../../styles/bom.css";

export type { BomImportApi };

export function BomImportPage({ api, pickFile }: { api?: BomImportApi; pickFile?: () => Promise<string | null> }) {
  const state = useBomImport({ api, pickFile });
  const fileName = state.path.split(/[\\/]/).pop() || "";
  const toolbarActions = useMemo(() => <>
    <label className="bom-toolbar__remark">备注名<input className="pn-control" aria-label="BOM备注名" value={state.displayName} onChange={(event) => state.setDisplayName(event.target.value)} /></label>
    {fileName && <span className="bom-toolbar__file" title={state.path}>{fileName}</span>}
    <button className="pn-button pn-button--secondary" type="button" onClick={() => void state.chooseFile()}>选择文件</button>
    {state.status === "loading" && <StatusBadge tone="active">解析中</StatusBadge>}
    {state.status === "ready" && <StatusBadge tone="success">已就绪</StatusBadge>}
  </>, [fileName, state.displayName, state.path, state.status, state.chooseFile]);
  const inShell = usePageActions(toolbarActions);
  return <section aria-label="BOM 分析">
    {!inShell && <PageToolbar title="BOM 操作" actions={toolbarActions} />}
    {state.error && <p role="alert">{state.error}</p>}
    {state.status === "needsMapping" && <FieldMappingDialog headers={state.headers} mapping={state.mapping} onChange={state.setMapping} onConfirm={() => void state.submitMapping()} onCancel={state.cancelMapping} />}
    {state.status === "ready" && <BomAnalysisTable rows={state.rows} onConfirmMatch={state.confirmMatch} />}
  </section>;
}
