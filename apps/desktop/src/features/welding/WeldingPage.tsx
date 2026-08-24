import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cachedBomUrl, desktopApi, errorMessage, normalizePart, type BomSide, type CachedBomSession, type ConfirmTakeInput, type DesktopApi, type Part, type ResolvedBomSelection, type WeldingProgress } from "../../app/tauri";
import { matchBomGroup } from "../../../../../packages/domain/src/bom/matching";
import type { InventoryPart } from "../../../../../packages/domain/src/bom/types";
import { BomFrame } from "./BomFrame";
import { ComponentTray } from "./ComponentTray";
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
  const [trayCollapsed, setTrayCollapsed] = useState(false);
  const columns = useResizableColumns({ component: 180, package: 120, quantity: 96, side: 100 });

  useEffect(() => {
    let active = true;
    void Promise.all([api.restoreActiveInteractiveBom(), api.listParts()]).then(([restored, listed]) => {
      if (!active) return;
      setSession(restored);
      setParts(listed.map((part) => normalizePart(part)));
      if (restored) void api.getWeldingProgress(restored.session_id).then((items) => active && setProgress(items)).catch(() => undefined);
    }).catch((cause) => active && setError(errorMessage(cause)));
    return () => { active = false; };
  }, [api]);

  const selectedGroup = useMemo(() => selection && session?.normalized.groups.find((group) => group.component_key === selection.component_key) || null, [selection, session]);
  const authoritativeMatch = useMemo(() => {
    if (!selectedGroup) return { kind: "none" as const };
    const inventory: InventoryPart[] = parts.map((part) => ({
      id: part.id,
      name: part.name,
      package: part.package ?? "",
      mpn: part.mpn ?? "",
      lcscCode: part.lcsc_code ?? "",
      value: part.name,
    }));
    return matchBomGroup({
      componentKey: selectedGroup.component_key,
      name: selectedGroup.name,
      value: selectedGroup.value,
      package: selectedGroup.package,
      manufacturer: selectedGroup.manufacturer,
      mpn: selectedGroup.mpn,
      lcscCode: selectedGroup.lcsc_code,
      placements: [],
      extraFields: selectedGroup.extra_fields,
    }, inventory);
  }, [parts, selectedGroup]);
  const selectedPart = useMemo(() => {
    if (!selectedGroup) return null;
    if (selectedPartId) return parts.find((part) => part.id === selectedPartId) ?? null;
    if (authoritativeMatch.kind === "exact-lcsc" || authoritativeMatch.kind === "exact-mpn") {
      return parts.find((part) => part.id === authoritativeMatch.partId) ?? null;
    }
    return null;
  }, [authoritativeMatch, parts, selectedGroup, selectedPartId]);
  const selectableParts = useMemo(() => authoritativeMatch.kind === "candidate"
    ? parts.filter((part) => authoritativeMatch.partIds.includes(part.id))
    : parts, [authoritativeMatch, parts]);
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
    if (!session || !selection || !selectedGroup || !selectedPart || side === "all" || selectedDesignators.length === 0) return;
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
      setParts(listed.map((item) => {
        const normalized = normalizePart(item);
        return normalized.id === result.part_id ? { ...normalized, version: Math.max(normalized.version, result.part_version) } : normalized;
      }));
      setProgress(updatedProgress);
      setNotice("已确认取用");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally { setBusy(false); }
  }

  return <section aria-label="焊接工作台">
    {!session ? <p>暂无活动 BOM</p> : <div className="welding-workspace" data-testid="welding-layout" data-split="65-35">
      <div className="welding-bom bom-canvas-light" data-bom-canvas><BomFrame src={cachedBomUrl(session.cache_path)} frameRef={frameRef} /></div>
      <div className="welding-right">
        <div className="welding-sides" role="tablist" aria-label="板面"><button className={`pn-button ${side === "top" ? "pn-button--primary" : "pn-button--secondary"}`} type="button" role="tab" aria-selected={side === "top"} onClick={() => setSide("top")}>顶层</button><button className={`pn-button ${side === "bottom" ? "pn-button--primary" : "pn-button--secondary"}`} type="button" role="tab" aria-selected={side === "bottom"} onClick={() => setSide("bottom")}>底层</button><button className={`pn-button ${side === "all" ? "pn-button--primary" : "pn-button--secondary"}`} type="button" role="tab" aria-selected={side === "all"} onClick={() => setSide("all")}>全部</button></div>
        {selection && selectedGroup ? <>
          <p>当前选择：{selectedDesignators.join(", ")}</p>
          <TakePanel group={selectedGroup} side={side} designators={selectedDesignators} part={selectedPart} parts={selectableParts} progress={progress} onPartChange={setSelectedPartId} onConfirm={confirm} error={error} busy={busy} />
          {notice && <p>{notice}</p>}
        </> : <p>请在 BOM 中选择器件</p>}
      </div>
      <ComponentTray groups={session.normalized.groups} side={side} activeComponentKey={selection?.component_key ?? null} widths={columns.widths} onResizeStart={columns.startResize} onResizeKey={columns.adjustWidth} collapsed={trayCollapsed} onToggle={() => setTrayCollapsed((value) => !value)} />
    </div>}
  </section>;
}
