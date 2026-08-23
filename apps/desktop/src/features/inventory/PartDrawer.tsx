import { Drawer } from "../../components/ui/Overlay";
import { FormField } from "../../components/ui/FormField";
import type { Part, PartInput } from "../../app/tauri";

const isPartDirty = (form: PartInput, editing: Part | null) => {
  if (!editing) return form.name !== "" || form.category !== "" || form.package !== "" || form.manufacturer !== "" || form.mpn !== "" || form.lcsc_code !== "" || form.box_id !== "" || form.slot !== "" || form.quantity !== 0 || form.note !== "";
  return ["name", "category", "package", "manufacturer", "mpn", "lcsc_code", "quantity", "box_id", "slot", "note"].some((key) => form[key as keyof PartInput] !== (editing[key as keyof Part] ?? ""));
};

export function PartDrawer({ open, editing, form, error, onChange, onSave, onRequestClose }: {
  open: boolean;
  editing: Part | null;
  form: PartInput;
  error?: string;
  onChange: (field: keyof PartInput, value: string | number) => void;
  onSave: () => void;
  onRequestClose: () => void;
}): JSX.Element | null {
  const field = (name: keyof PartInput, label: string, props: Record<string, unknown> = {}) => <FormField key={name} label={label} htmlFor={`part-${name}`}>
    <input id={`part-${name}`} className="pn-control" required={name === "name" || name === "box_id" || name === "slot"} readOnly={name === "quantity" && Boolean(editing)} value={form[name]} onChange={(event) => onChange(name, name === "quantity" ? Number(event.target.value) : event.target.value)} {...props} />
  </FormField>;
  return <Drawer open={open} title={editing ? "编辑器件" : "新增器件"} dirty={isPartDirty(form, editing)} confirmDiscard={() => window.confirm("放弃未保存更改？")} onRequestClose={onRequestClose}>
    <form className="pn-drawer-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      {error && <p className="pn-inline-error" role="alert">{error}</p>}
      {field("name", "名称")}
      {field("category", "分类")}
      {field("package", "封装")}
      {field("manufacturer", "制造商")}
      {field("mpn", "MPN")}
      {field("lcsc_code", "LCSC")}
      {field("box_id", "收纳盒 ID")}
      {field("slot", "盒位")}
      {field("quantity", "数量", { type: "number", min: 0 })}
      {field("note", "备注")}
      <div className="pn-form-actions"><button className="pn-button pn-button--primary" type="submit">保存器件</button><button className="pn-button pn-button--ghost" type="button" onClick={onRequestClose}>取消</button></div>
    </form>
  </Drawer>;
}
