import type { BomAnalysisRow } from "./useBomImport";

const statusLabel = { exact: "精确匹配", candidate: "候选匹配", none: "未匹配" } as const;

export function BomAnalysisTable({ rows, onConfirmMatch }: { rows: BomAnalysisRow[]; onConfirmMatch: (componentKey: string, partId: string) => void }) {
  return <section aria-labelledby="bom-analysis-title">
    <h3 id="bom-analysis-title">缺料分析</h3>
    <table>
      <thead><tr><th>器件</th><th>封装</th><th>BOM 数量</th><th>库存</th><th>缺料</th><th>匹配状态</th><th>盒位</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.componentKey}>
        <td>{row.name || row.value}</td><td>{row.package}</td><td>{row.required}</td><td>{row.stock}</td><td>{row.shortage}</td>
        <td>{statusLabel[row.status]}{row.status === "candidate" && row.candidateIds?.map((id) => <button key={id} type="button" onClick={() => onConfirmMatch(row.componentKey, id)}>确认匹配</button>)}</td>
        <td>{row.boxSlot ?? "—"}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
