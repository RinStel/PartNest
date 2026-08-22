import { useEffect, useState } from "react";
import type { BomGroup, BomSide, Part, WeldingProgress } from "../../app/tauri";

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
  }, [bomQuantity, side]);

  const status = (value: BomSide) => progress.find((item) => item.component_key === group.component_key && item.side === value)?.status ?? "pending";
  if (side === "all") {
    return <section aria-label="取用面板"><h3>取用</h3><p>顶层：{status("top") === "taken" ? "已取用" : status("top") === "partial" ? "部分取用" : "待取用"}</p><p>底层：{status("bottom") === "taken" ? "已取用" : status("bottom") === "partial" ? "部分取用" : "待取用"}</p></section>;
  }

  return <section aria-label="取用面板">
    <h3>取用</h3>
    <dl>
      <div><dt>器件</dt><dd>{group.name || group.value}</dd></div>
      <div><dt>盒位</dt><dd>{part?.box_id && part.slot ? `${part.box_id}/${part.slot}` : "—"}</dd></div>
      <div><dt>库存</dt><dd>{part?.quantity ?? "—"}</dd></div>
      <div><dt>位号</dt><dd>{designators.join(", ")}</dd></div>
      <div><dt>BOM 数量</dt><dd>{bomQuantity}</dd></div>
    </dl>
    <label>取用数量 <input aria-label="取用数量" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
    <label>器件 <select aria-label="选择器件" value={part?.id ?? ""} onChange={(event) => onPartChange(event.target.value)}><option value="">选择器件</option>{parts.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.quantity}）</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy || !part || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0} onClick={() => void onConfirm(Number(quantity))}>确认取用（−{quantity || 0}）</button>
  </section>;
}
