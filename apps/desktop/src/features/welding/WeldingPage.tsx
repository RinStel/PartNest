import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi, errorMessage, type BomSide, type CachedBomSession, type ConfirmTakeInput, type DesktopApi, type Part, type ResolvedBomSelection, type WeldingProgress } from "../../app/tauri";
import { BomFrame } from "./BomFrame";
import { TakePanel } from "./TakePanel";
import { useBomBridge } from "./useBomBridge";
import { useResizableColumns } from "./useResizableColumns";

export type WeldingApi = Pick<DesktopApi, "restoreActiveInteractiveBom" | "resolveBomSelection" | "listParts" | "confirmTake" | "getWeldingProgress">;

export function WeldingPage({ api = desktopApi }: { api?: WeldingApi }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState<CachedBomSession | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [progress, setProgress] = useState<WeldingProgress[]>([]);
  const [selection, setSelection] = useState<ResolvedBomSelection | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [side, setSide] = useState<BomSide | "all">("top");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const columns = useResizableColumns({ component: 180, package: 120, quantity: 96, side: 100 });

  useEffect(() => {
    let active = true;
    void Promise.all([api.restoreActiveInteractiveBom(), api.listParts()]).then(([restored, listed]) => {
      if (!active) return;
      setSession(restored);
      setParts(listed);
      if (restored) void api.getWeldingProgress(restored.session_id).then((items) => active && setProgress(items)).catch(() => undefined);
    }).catch((cause) => active && setError(errorMessage(cause)));
    return () => { active = false; };
  }, [api]);

  const selectedGroup = useMemo(() => selection && session?.normalized.groups.find((group) => group.component_key === selection.component_key) || null, [selection, session]);
  const selectedPart = useMemo(() => {
    if (!selectedGroup) return null;
    if (selectedPartId) return parts.find((part) => part.id === selectedPartId) ?? null;
    return parts.find((part) => (selectedGroup.lcsc_code && part.lcsc_code === selectedGroup.lcsc_code) || (selectedGroup.mpn && part.mpn === selectedGroup.mpn) || part.name === selectedGroup.name) ?? null;
  }, [parts, selectedGroup, selectedPartId]);
  const selectedDesignators = selectedGroup && selection
    ? side === "all" || side === selection.side
      ? selection.designators
      : selectedGroup.placements.filter((placement) => placement.side === side).map((placement) => placement.designator)
    : [];

  const onResolved = useCallback((resolved: ResolvedBomSelection) => {
    setSelection(resolved);
    setSide(resolved.side);
    setSelectedPartId(null);
    setError("");
    setNotice("");
  }, []);
  const onBridgeError = useCallback((cause: unknown) => setError(errorMessage(cause)), []);
  useBomBridge({ frameRef, session, api, onResolved, onError: onBridgeError });

  async function confirm(quantity: number) {
    if (!session || !selection || !selectedGroup || !selectedPart || side === "all") return;
    setBusy(true); setError(""); setNotice("");
    const input: ConfirmTakeInput = {
      session_id: session.session_id,
      component_key: selection.component_key,
      side,
      designators: selectedDesignators,
      bom_quantity: selectedDesignators.length,
      take_quantity: quantity,
      part_id: selectedPart.id,
      expected_part_version: selectedPart.version,
    };
    try {
      const result = await api.confirmTake(input);
      const [listed, updatedProgress] = await Promise.all([api.listParts(), api.getWeldingProgress(session.session_id)]);
      setParts(listed.map((item) => item.id === result.part_id ? { ...item, version: Math.max(item.version, result.part_version) } : item));
      setProgress(updatedProgress);
      setNotice("已确认取用");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  const resizeButton = (column: string, label: string) => <button type="button" role="separator" aria-label={`调整${label}列宽`} tabIndex={0} onMouseDown={(event) => columns.startResize(column, event)}>↔</button>;
  return <section aria-labelledby="welding-title">
    <h2 id="welding-title">焊接工作台</h2>
    {!session ? <p>暂无活动 BOM</p> : <div className="welding-workspace">
      <div className="welding-bom"><BomFrame src={session.cache_path} frameRef={frameRef} /></div>
      <div className="welding-right">
        <div className="welding-sides" role="tablist" aria-label="板面"><button type="button" role="tab" aria-selected={side === "top"} onClick={() => setSide("top")}>顶层</button><button type="button" role="tab" aria-selected={side === "bottom"} onClick={() => setSide("bottom")}>底层</button><button type="button" role="tab" aria-selected={side === "all"} onClick={() => setSide("all")}>全部</button></div>
        {selection && selectedGroup ? <>
          <p>当前选择：{selectedDesignators.join(", ")}</p>
          <div className="welding-component-table" role="table" aria-label="器件列表">
            <div role="row"><div role="columnheader" data-testid="component-column" style={{ width: columns.widths.component }}>器件 {resizeButton("component", "器件")}</div><div role="columnheader" style={{ width: columns.widths.package }}>封装 {resizeButton("package", "封装")}</div><div role="columnheader" style={{ width: columns.widths.quantity }}>数量 {resizeButton("quantity", "数量")}</div><div role="columnheader" style={{ width: columns.widths.side }}>板面 {resizeButton("side", "板面")}</div></div>
            <div role="row"><div role="cell">{selectedGroup.name || selectedGroup.value}</div><div role="cell">{selectedGroup.package}</div><div role="cell">{selectedDesignators.length}</div><div role="cell">{side}</div></div>
          </div>
          <TakePanel group={selectedGroup} side={side} designators={selectedDesignators} part={selectedPart} parts={parts} progress={progress} onPartChange={setSelectedPartId} onConfirm={confirm} error={error} busy={busy} />
          {notice && <p>{notice}</p>}
        </> : <p>请在 BOM 中选择器件</p>}
      </div>
    </div>}
  </section>;
}
