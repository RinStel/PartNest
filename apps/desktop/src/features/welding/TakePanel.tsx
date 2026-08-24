import { useEffect, useState } from "react";
import type { BomGroup, BomSide, Part, WeldingProgress } from "../../app/tauri";
import { StatusBadge, type StatusTone } from "../../components/ui/StatusBadge";

export function TakePanel({
  group,
  side,
  designators,
  part,
  parts,
  progress,
  onPartChange,
  onConfirm,
  error,
  busy,
}: {
  group: BomGroup;
  side: BomSide | "all";
  designators: string[];
  part: Part | null;
  parts: Part[];
  progress: WeldingProgress[];
  onPartChange: (partId: string) => void;
  onConfirm: (quantity: number) => Promise<void>;
  error: string;
  busy: boolean;
}) {
  const bomQuantity = designators.length;
  const [quantity, setQuantity] = useState(String(Math.max(1, bomQuantity)));

  useEffect(() => {
    setQuantity(String(Math.max(1, bomQuantity)));
  }, [bomQuantity, group.component_key, side]);

  const status = (value: BomSide) => progress.find((item) => item.component_key === group.component_key && item.side === value)?.status ?? "pending";
  const statusLabel = (value: string) => value === "taken" ? "已取用" : value === "partial" ? "部分取用" : "待取用";
  const statusTone = (value: string): StatusTone => value === "taken" ? "success" : value === "partial" ? "warning" : "neutral";
  if (side === "all") {
    return <section aria-label="取用面板"><h3>取用</h3><p><span className="welding-status-label">顶层：{statusLabel(status("top"))}</span><StatusBadge tone={statusTone(status("top"))}>顶层 · {statusLabel(status("top"))}</StatusBadge></p><p><span className="welding-status-label">底层：{statusLabel(status("bottom"))}</span><StatusBadge tone={statusTone(status("bottom"))}>底层 · {statusLabel(status("bottom"))}</StatusBadge></p></section>;
  }

  return <section aria-label="取用面板">
    <h3>取用</h3>
    <p><span className="welding-status-label">板面：{side === "top" ? "顶层" : "底层"} · {statusLabel(status(side))}</span><StatusBadge tone={statusTone(status(side))}>{side === "top" ? "顶层" : "底层"} · {statusLabel(status(side))}</StatusBadge></p>
    {!designators.length ? <p className="welding-empty-side" role="status">当前面无器件</p> : <>
      <dl>
        <div><dt>器件</dt><dd>{group.name || group.value}</dd></div>
        <div><dt>盒位</dt><dd>{part?.box_id && part.slot ? `${part.box_id}/${part.slot}` : "—"}</dd></div>
        <div><dt>库存</dt><dd>{part?.quantity ?? "—"}</dd></div>
        <div><dt>位号</dt><dd>{designators.join(", ")}</dd></div>
        <div><dt>BOM 数量</dt><dd>{bomQuantity}</dd></div>
      </dl>
      <label>取用数量 <input className="pn-control" aria-label="取用数量" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      <label>器件 <select className="pn-control" aria-label="选择器件" value={part?.id ?? ""} onChange={(event) => onPartChange(event.target.value)}><option value="">选择器件</option>{parts.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.quantity}）</option>)}</select></label>
      {error && <p role="alert">{error}</p>}
      <button className="pn-button pn-button--primary" type="button" disabled={busy || !part || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0} onClick={() => void onConfirm(Number(quantity))}>确认取用（−{quantity || 0}）</button>
    </>}
  </section>;
}
