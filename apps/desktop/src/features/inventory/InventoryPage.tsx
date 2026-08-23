import { useEffect, useMemo, useRef, useState } from "react";
import { DesktopApi, desktopApi, errorMessage, normalizePart, Part, PartInput } from "../../app/tauri";
import { DataTable, type DataColumn } from "../../components/ui/DataTable";
import { usePageActions } from "../../app/AppShell";
import { PartDrawer } from "./PartDrawer";

const blankPart: PartInput = { name: "", category: "", package: "", manufacturer: "", mpn: "", lcsc_code: "", quantity: 0, box_id: "", slot: "", note: "" };
type InventoryApi = Pick<DesktopApi, "listParts" | "createPart" | "updatePart" | "adjustStock"> & Partial<Pick<DesktopApi, "deletePart">>;
const toInput = (part: Part): PartInput => ({ ...part, category: part.category ?? "", package: part.package ?? "", manufacturer: part.manufacturer ?? "", mpn: part.mpn ?? "", lcsc_code: part.lcsc_code ?? "", note: part.note ?? "" });

export function InventoryPage({ api = desktopApi }: { api?: InventoryApi }): JSX.Element {
  const [parts, setParts] = useState<Part[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<PartInput>(blankPart);
  const [editing, setEditing] = useState<Part | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerCloseRef = useRef<(() => Promise<boolean>) | null>(null);
  const [adjustment, setAdjustment] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = async () => { try { setParts((await api.listParts(search)).map(normalizePart)); } catch (cause) { setError(errorMessage(cause)); } };
  useEffect(() => { void load(); }, [search]);
  const setField = (field: keyof PartInput, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const beginCreate = () => { setEditing(null); setForm({ ...blankPart }); setError(""); setDrawerOpen(true); };
  const openCreate = () => {
    if (drawerOpen) { const requestClose = drawerCloseRef.current; if (requestClose) void requestClose().then((closed) => { if (closed) beginCreate(); }); return; }
    beginCreate();
  };
  const openEdit = (part: Part) => { setEditing(part); setForm(toInput(part)); setError(""); setDrawerOpen(true); };
  const closeDrawer = () => { setDrawerOpen(false); setEditing(null); setForm({ ...blankPart }); };
  async function save() {
    setError("");
    try {
      const saved = normalizePart(editing ? await api.updatePart(editing.id, editing.version, form) : await api.createPart(form));
      setParts((current) => editing ? current.map((part) => part.id === saved.id ? saved : part) : [...current, saved]);
      closeDrawer();
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function adjust(part: Part) {
    const delta = Number(adjustment[part.id] ?? 0);
    if (!delta) return;
    setError("");
    try {
      const updated = normalizePart(await api.adjustStock(part.id, delta, "手工调整"));
      setParts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setAdjustment((current) => ({ ...current, [part.id]: "" }));
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function remove(part: Part) {
    if (!api.deletePart || !window.confirm(`删除器件“${part.name}”？`)) return;
    setError("");
    try { await api.deletePart(part.id); setParts((current) => current.filter((item) => item.id !== part.id)); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  const columns = useMemo<DataColumn<Part>[]>(() => [
    { id: "name", header: "名称", width: 150, cell: (part) => part.name },
    { id: "category", header: "分类", width: 100, cell: (part) => part.category || "—" },
    { id: "package", header: "封装", width: 90, cell: (part) => part.package || "—" },
    { id: "manufacturer", header: "制造商", width: 120, cell: (part) => part.manufacturer || "—" },
    { id: "mpn", header: "MPN", width: 130, cell: (part) => part.mpn || "—" },
    { id: "lcsc", header: "LCSC", width: 90, cell: (part) => part.lcsc_code || "—" },
    { id: "box", header: "盒位", width: 120, cell: (part) => `${part.box_id || "—"}${part.slot ? ` / ${part.slot}` : ""}` },
    { id: "quantity", header: "库存", width: 70, cell: (part) => part.quantity },
    { id: "actions", header: "操作", width: 260, cell: (part) => <div className="inventory-actions">
      <button className="pn-button pn-button--ghost" type="button" onClick={() => openEdit(part)}>编辑</button>
      <span className="inventory-adjust"><input className="pn-control" aria-label={`${part.name}调整数量`} type="number" value={adjustment[part.id] ?? ""} onChange={(event) => setAdjustment((current) => ({ ...current, [part.id]: event.target.value }))} /><button className="pn-button pn-button--secondary" type="button" onClick={() => void adjust(part)}>调整</button></span>
      {api.deletePart && <button className="pn-button pn-button--ghost" type="button" onClick={() => void remove(part)}>删除</button>}
    </div> },
  ], [adjustment, api.deletePart]);
  const toolbarActions = useMemo(() => <><input className="pn-control" aria-label="搜索库存" placeholder="名称、MPN 或 LCSC" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="pn-button pn-button--primary" type="button" onClick={openCreate}>新增器件</button></>, [search, drawerOpen]);
  const inShell = usePageActions(toolbarActions);
  return <section className="inventory-page" aria-label="库存管理">
    {!inShell && <div className="inventory-local-toolbar">{toolbarActions}</div>}
    {error && !drawerOpen && <p className="pn-inline-error" role="alert">{error}</p>}
    <DataTable label="器件列表" rows={parts} columns={columns} rowKey={(part) => part.id} emptyText="暂无器件" />
    <PartDrawer open={drawerOpen} editing={editing} form={form} error={error} onChange={setField} onSave={() => void save()} onRequestClose={closeDrawer} onRequestCloseReady={(request) => { drawerCloseRef.current = request; }} />
  </section>;
}
