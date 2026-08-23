import { useEffect, useState } from "react";
import { DesktopApi, desktopApi, errorMessage, normalizePart, Part, PartInput } from "../../app/tauri";

const blankPart: PartInput = { name: "", category: "", package: "", manufacturer: "", mpn: "", lcsc_code: "", quantity: 0, box_id: "", slot: "", note: "" };

type InventoryApi = Pick<DesktopApi, "listParts" | "createPart" | "updatePart" | "adjustStock"> &
  Partial<Pick<DesktopApi, "deletePart">>;

const toInput = (part: Part): PartInput => ({
  name: part.name,
  category: part.category ?? "",
  package: part.package ?? "",
  manufacturer: part.manufacturer ?? "",
  mpn: part.mpn ?? "",
  lcsc_code: part.lcsc_code ?? "",
  quantity: part.quantity,
  box_id: part.box_id,
  slot: part.slot,
  note: part.note ?? "",
});

export function InventoryPage({ api = desktopApi }: { api?: InventoryApi }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<PartInput>(blankPart);
  const [editing, setEditing] = useState<Part | null>(null);
  const [adjustment, setAdjustment] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = async () => { try { setParts((await api.listParts(search)).map((part) => normalizePart(part))); } catch (cause) { setError(errorMessage(cause)); } };
  useEffect(() => { void load(); }, [search]);
  const setField = (field: keyof PartInput, value: string | number) => setForm((current) => ({ ...current, [field]: value }));

  async function save() {
    setError("");
    try {
      const saved = normalizePart(editing ? await api.updatePart(editing.id, editing.version, form) : await api.createPart(form));
      setParts((current) => editing ? current.map((part) => part.id === saved.id ? saved : part) : [...current, saved]);
      setEditing(null); setForm(blankPart);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  async function adjust(part: Part) {
    const delta = Number(adjustment[part.id] ?? 0);
    if (!delta) return;
    try {
      const updated = normalizePart(await api.adjustStock(part.id, delta, "手工调整"));
      setParts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setAdjustment((current) => ({ ...current, [part.id]: "" }));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function remove(part: Part) {
    if (!api.deletePart) return;
    setError("");
    try {
      await api.deletePart(part.id);
      setParts((current) => current.filter((item) => item.id !== part.id));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <section aria-label="库存管理">
    <label>搜索 <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、MPN 或 LCSC" /></label>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{editing ? "编辑器件" : "新建器件"}</h3>
      <label>名称 <input required value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
      <label>分类 <input value={form.category} onChange={(event) => setField("category", event.target.value)} /></label>
      <label>封装 <input value={form.package} onChange={(event) => setField("package", event.target.value)} /></label>
      <label>制造商 <input value={form.manufacturer} onChange={(event) => setField("manufacturer", event.target.value)} /></label>
      <label>MPN <input value={form.mpn} onChange={(event) => setField("mpn", event.target.value)} /></label>
      <label>LCSC <input value={form.lcsc_code} onChange={(event) => setField("lcsc_code", event.target.value)} /></label>
      <label>收纳盒 ID <input required value={form.box_id} onChange={(event) => setField("box_id", event.target.value)} /></label>
      <label>盒位 <input required value={form.slot} onChange={(event) => setField("slot", event.target.value)} /></label>
      <label>数量 <input type="number" min="0" readOnly={Boolean(editing)} value={form.quantity} onChange={(event) => setField("quantity", Number(event.target.value))} /></label>
      <label>备注 <input value={form.note} onChange={(event) => setField("note", event.target.value)} /></label>
      <button type="submit">保存器件</button>
      {editing && <button type="button" onClick={() => { setEditing(null); setForm(blankPart); }}>取消</button>}
    </form>
    <table><thead><tr><th>名称</th><th>盒位</th><th>数量</th><th>操作</th></tr></thead><tbody>
      {parts.map((part) => <tr key={part.id}><td>{part.name}</td><td>{part.slot}</td><td>{part.quantity}</td><td>
        <button type="button" onClick={() => { setEditing(part); setForm(toInput(normalizePart(part))); }}>编辑</button>
        <input aria-label={`${part.name}调整数量`} type="number" value={adjustment[part.id] ?? ""} onChange={(event) => setAdjustment((current) => ({ ...current, [part.id]: event.target.value }))} />
        <button type="button" onClick={() => void adjust(part)}>调整数量</button>
        {api.deletePart && <button type="button" onClick={() => void remove(part)}>删除</button>}
      </td></tr>)}
    </tbody></table>
  </section>;
}
