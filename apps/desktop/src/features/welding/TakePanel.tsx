import { useEffect, useState } from "react";
import type { BomGroup, BomSide, Part, WeldingProgress } from "../../app/tauri";
import { StatusBadge, type StatusTone } from "../../components/ui/StatusBadge";

export function TakePanel({
  group,
  side,
  designators,
  pendingDesignators,
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
  /** 当前板面上尚未扣减库存的位号。 */
  pendingDesignators: string[];
  part: Part | null;
  parts: Part[];
  progress: WeldingProgress[];
  onPartChange: (partId: string) => void;
  onConfirm: (quantity: number) => Promise<void>;
  error: string;
  busy: boolean;
}) {
  const takeableQuantity = pendingDesignators.length;
  const [quantity, setQuantity] = useState(String(Math.max(1, takeableQuantity)));

  // 默认数量始终等于待取位数，重复提交同一选择不会静默多扣库存。
  useEffect(() => {
    setQuantity(String(Math.max(1, takeableQuantity)));
  }, [takeableQuantity, group.component_key, side]);

  const confirmedOnSide = progress.find((item) => item.component_key === group.component_key && item.side === side)?.confirmed_designators ?? [];

  const status = (value: BomSide) => progress.find((item) => item.component_key === group.component_key && item.side === value)?.status ?? "pending";
  const statusLabel = (value: string) => value === "taken" ? "已取用" : value === "partial" ? "部分取用" : "待取用";
  const statusTone = (value: string): StatusTone => value === "taken" ? "success" : value === "partial" ? "warning" : "neutral";
  if (side === "all") {
    return <section className="take-panel" aria-label="取用面板">
      <div className="take-panel__header"><h2>取用状态</h2></div>
      <div className="take-panel__statuses">
        <span><span className="welding-status-label">顶层：{statusLabel(status("top"))}</span><StatusBadge tone={statusTone(status("top"))}>顶层 · {statusLabel(status("top"))}</StatusBadge></span>
        <span><span className="welding-status-label">底层：{statusLabel(status("bottom"))}</span><StatusBadge tone={statusTone(status("bottom"))}>底层 · {statusLabel(status("bottom"))}</StatusBadge></span>
      </div>
    </section>;
  }

  return <section className="take-panel" aria-label="取用面板">
    <div className="take-panel__header"><h2>取用信息</h2><span className="welding-status-label">板面：{side === "top" ? "顶层" : "底层"} · {statusLabel(status(side))}</span><StatusBadge tone={statusTone(status(side))}>{side === "top" ? "顶层" : "底层"} · {statusLabel(status(side))}</StatusBadge></div>
    {!designators.length ? <p className="welding-empty-side" role="status">当前面无器件</p> : <>
      <div className="take-panel__details">
        <div><span>器件</span><strong>{group.name || group.value}</strong></div>
        <div><span>盒位</span><strong>{part?.box_id && part.slot ? `${part.box_id}/${part.slot}` : "—"}</strong></div>
        <div><span>库存</span><strong>{part?.quantity ?? "—"}</strong></div>
        <div><span>位号</span><strong>{designators.join(", ")}</strong></div>
        {!!confirmedOnSide.length && <div><span>已取用位号</span><strong>{confirmedOnSide.join(", ")}</strong></div>}
      </div>
      <div className="take-panel__controls">
        <label>取用数量 <input className="pn-control" aria-label="取用数量" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label>器件 <select className="pn-control" aria-label="选择器件" value={part?.id ?? ""} onChange={(event) => onPartChange(event.target.value)}><option value="">选择器件</option>{parts.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.quantity}）</option>)}</select></label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!pendingDesignators.length && <p className="welding-feedback" role="status">所选位号在当前板面均已取用</p>}
      <button className="pn-button pn-button--primary" type="button" disabled={busy || !part || !pendingDesignators.length || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0} onClick={() => void onConfirm(Number(quantity))}>确认取用（−{quantity || 0}）</button>
    </>}
  </section>;
}
