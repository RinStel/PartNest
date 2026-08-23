import { useEffect, useMemo, useState } from "react";
import { Box, DesktopApi, desktopApi, errorMessage, normalizePart, Part } from "../../app/tauri";
import { usePageActions } from "../../app/AppShell";
import { BoxDialog, type BoxDraft } from "./BoxDialog";

type BoxesApi = Pick<DesktopApi, "listBoxes" | "createBox" | "resizeBox"> & Partial<Pick<DesktopApi, "updateBox" | "deleteBox" | "listParts">>;
const emptyDraft: BoxDraft = { name: "", rows: 4, cols: 4 };
const slotName = (index: number, cols: number) => `${String.fromCharCode(65 + Math.floor(index / cols))}${index % cols}`;

export function BoxesPage({ api = desktopApi }: { api?: BoxesApi }): JSX.Element {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Box | null>(null);
  const [draft, setDraft] = useState<BoxDraft>(emptyDraft);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      const [boxResult, partResult] = await Promise.all([api.listBoxes(), api.listParts ? api.listParts() : Promise.resolve([])]);
      setBoxes(boxResult); setParts(partResult.map(normalizePart));
      setSelectedId((current) => current || boxResult[0]?.id || "");
    } catch (cause) { setError(errorMessage(cause)); }
  };
  useEffect(() => { void load(); }, []);
  const selected = boxes.find((box) => box.id === selectedId) ?? null;
  const partBySlot = useMemo(() => new Map(parts.filter((part) => part.box_id === selected?.id).map((part) => [part.slot, part])), [parts, selected?.id]);
  const openCreate = () => { setEditing(null); setDraft({ ...emptyDraft }); setError(""); setDialogOpen(true); };
  const openEdit = () => { if (!selected) return; setEditing(selected); setDraft({ name: selected.name, rows: selected.rows, cols: selected.cols }); setError(""); setDialogOpen(true); };
  const closeDialog = () => { setDialogOpen(false); setEditing(null); setDraft({ ...emptyDraft }); };
  async function saveBox() {
    setError("");
    if (draft.cols > 100) { setError("列数不能超过 100"); return; }
    try {
      const saved = editing
        ? (api.updateBox ? await api.updateBox(editing.id, draft) : await api.resizeBox(editing.id, draft.rows, draft.cols))
        : await api.createBox(draft);
      setBoxes((current) => editing ? current.map((box) => box.id === saved.id ? saved : box) : [...current, saved]);
      setSelectedId(saved.id); closeDialog();
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function removeSelected() {
    if (!selected || !api.deleteBox || !window.confirm(`删除收纳盒“${selected.name}”？`)) return;
    setError("");
    try { await api.deleteBox(selected.id); const next = boxes.filter((box) => box.id !== selected.id); setBoxes(next); setSelectedId(next[0]?.id ?? ""); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  const toolbarActions = useMemo(() => <button className="pn-button pn-button--primary" type="button" onClick={openCreate}>新增收纳盒</button>, []);
  const inShell = usePageActions(toolbarActions);
  return <section className="inventory-page" aria-label="收纳盒">
    {!inShell && <div className="inventory-local-toolbar">{toolbarActions}</div>}
    {error && !dialogOpen && <p className="pn-inline-error" role="alert">{error}</p>}
    <div className="boxes-page">
      <aside className="boxes-list" aria-label="收纳盒列表">
        {boxes.length === 0 ? <p className="boxes-empty">暂无收纳盒</p> : boxes.map((box) => <button key={box.id} className="boxes-list__item" type="button" aria-current={box.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(box.id)}><span>{box.name}</span><span className="boxes-list__count">{box.rows}×{box.cols}</span></button>)}
      </aside>
      <div className="box-workspace" aria-label={selected ? `${selected.name}槽位` : "槽位"}>
        {selected ? <>
          <div className="box-workspace__header"><h2 className="box-workspace__title">{selected.name}</h2><div className="inventory-actions"><button className="pn-button pn-button--secondary" type="button" onClick={openEdit}>编辑</button>{api.deleteBox && <button className="pn-button pn-button--ghost" type="button" onClick={() => void removeSelected()}>删除</button>}</div></div>
          <div className="box-grid" style={{ "--box-cols": selected.cols } as React.CSSProperties} aria-label={`${selected.name}盒位网格`}>
            {Array.from({ length: selected.rows * selected.cols }, (_, index) => { const slot = slotName(index, selected.cols); const part = partBySlot.get(slot); return <div key={slot} className={`box-slot${part ? " box-slot--occupied" : ""}`} aria-label={`${slot}${part ? ` 已占用 ${part.name} 数量 ${part.quantity}` : " 空闲"}`}><span>{slot}</span>{part && <><span className="box-slot__part">{part.name}</span><span className="box-slot__quantity">×{part.quantity}</span></>}</div>; })}
          </div>
        </> : <p className="boxes-empty">选择收纳盒</p>}
      </div>
    </div>
    <BoxDialog open={dialogOpen} editing={Boolean(editing)} dirty={Boolean(editing ? draft.name !== editing.name || draft.rows !== editing.rows || draft.cols !== editing.cols : draft.name !== "" || draft.rows !== 4 || draft.cols !== 4)} draft={draft} error={error} onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} onSave={() => void saveBox()} onRequestClose={closeDialog} />
  </section>;
}
