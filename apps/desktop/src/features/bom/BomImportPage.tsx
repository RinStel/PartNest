import { FieldMappingDialog } from "./FieldMappingDialog";
import { BomAnalysisTable } from "./BomAnalysisTable";
import { useBomImport, type BomImportApi } from "./useBomImport";

export type { BomImportApi };

export function BomImportPage({ api, pickFile }: { api?: BomImportApi; pickFile?: () => Promise<string | null> }) {
  const state = useBomImport({ api, pickFile });
  return <section aria-label="BOM 分析">
    <label>BOM备注名 <input value={state.displayName} onChange={(event) => state.setDisplayName(event.target.value)} /></label>
    <button type="button" onClick={() => void state.chooseFile()}>选择文件</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.status === "needsMapping" && <FieldMappingDialog headers={state.headers} mapping={state.mapping} onChange={state.setMapping} onConfirm={() => void state.submitMapping()} />}
    {state.status === "ready" && <BomAnalysisTable rows={state.rows} onConfirmMatch={state.confirmMatch} />}
  </section>;
}
