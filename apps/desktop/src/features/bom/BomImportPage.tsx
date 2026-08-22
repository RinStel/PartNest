import { FieldMappingDialog } from "./FieldMappingDialog";
import { BomAnalysisTable } from "./BomAnalysisTable";
import { useBomImport, type BomImportApi } from "./useBomImport";

export type { BomImportApi };

export function BomImportPage({ api, pickFile }: { api?: BomImportApi; pickFile?: () => Promise<string | null> }) {
  const state = useBomImport({ api, pickFile });
  return <section aria-labelledby="bom-import-title">
    <h2 id="bom-import-title">BOM 分析</h2>
    <label>选择 BOM 文件 <input type="file" accept=".html,.csv,.xlsx" onChange={() => void state.chooseFile()} /></label>
    {state.error && <p role="alert">{state.error}</p>}
    {state.status === "needsMapping" && <FieldMappingDialog headers={state.headers} mapping={state.mapping} onChange={state.setMapping} onConfirm={() => void state.submitMapping()} />}
    {state.status === "ready" && <BomAnalysisTable rows={state.rows} onConfirmMatch={state.confirmMatch} />}
  </section>;
}
