import { Drawer, useOverlayRequestClose } from "../../components/ui/Overlay";
import { useEffect, useState } from "react";
import { FormField } from "../../components/ui/FormField";
import type { Box, LcscPart, Part, PartInput } from "../../app/tauri";

const isPartDirty = (form: PartInput, quantityText: string, editing: Part | null) => {
  if (!editing) return form.name !== "" || form.category !== "" || form.package !== "" || form.manufacturer !== "" || form.mpn !== "" || form.lcsc_code !== "" || form.box_id !== "" || form.slot !== "" || quantityText !== "0" || form.note !== "";
  return ["name", "category", "package", "manufacturer", "mpn", "lcsc_code", "box_id", "slot", "note"].some((key) => form[key as keyof PartInput] !== (editing[key as keyof Part] ?? "")) || quantityText !== String(editing.quantity);
};

function slots(box: Box): string[] { return Array.from({ length: box.rows * box.cols }, (_, index) => `${String.fromCharCode(65 + Math.floor(index / box.cols))}${index % box.cols}`); }

export function PartDrawer({ open, editing, form, boxes, quantityText, error, lcscResult, onChange, onQuantityChange, onLookupLcsc, onSave, onRequestClose, onRequestCloseReady }: {
  open: boolean;
  editing: Part | null;
  form: PartInput;
  boxes: Box[];
  quantityText: string;
  error?: string;
  lcscResult: LcscPart | null;
  onChange: (field: keyof PartInput, value: string | number) => void;
  onQuantityChange: (value: string) => void;
  onLookupLcsc: (overwrite: boolean) => void;
  onSave: () => void;
  onRequestClose: () => void;
  onRequestCloseReady?: (request: (() => Promise<boolean>) | null) => void;
}): JSX.Element | null {
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const selectedBox = boxes.find((box) => box.id === form.box_id);
  useEffect(() => { if (!open) setSlotPickerOpen(false); }, [open]);
  const field = (name: Exclude<keyof PartInput, "box_id" | "slot" | "quantity">, label: string, props: Record<string, unknown> = {}) => <FormField key={name} label={label} htmlFor={`part-${name}`}>
    <input id={`part-${name}`} className="pn-control" required={name === "name"} value={form[name]} onChange={(event) => onChange(name, event.target.value)} {...props} />
  </FormField>;
  return <Drawer open={open} title={editing ? "编辑器件" : "新增器件"} dirty={isPartDirty(form, quantityText, editing)} confirmDiscard={() => window.confirm("放弃未保存更改？")} onRequestClose={onRequestClose}>
    <form className="pn-drawer-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <RequestCloseBridge onReady={onRequestCloseReady} />
      {error && <p className="pn-inline-error" role="alert">{error}</p>}
      {field("name", "名称")}
      {field("category", "分类")}
      {field("package", "封装")}
      {field("manufacturer", "制造商")}
      {field("mpn", "MPN")}
      <FormField label="LCSC" htmlFor="part-lcsc_code"><div className="part-lcsc-field"><input id="part-lcsc_code" className="pn-control" value={form.lcsc_code} onChange={(event) => onChange("lcsc_code", event.target.value)} /><button className="pn-button pn-button--secondary" type="button" disabled={!form.lcsc_code.trim()} onClick={() => onLookupLcsc(false)}>查询 LCSC</button>{lcscResult && <button className="pn-button pn-button--ghost" type="button" onClick={() => onLookupLcsc(true)}>重新填充</button>}</div></FormField>
      <FormField label="收纳盒" htmlFor="part-box_id"><select id="part-box_id" className="pn-control" required value={form.box_id} onChange={(event) => { onChange("box_id", event.target.value); onChange("slot", ""); }}><option value="">选择收纳盒</option>{boxes.map((box) => <option value={box.id} key={box.id}>{box.name}</option>)}</select></FormField>
      <FormField label="盒位" htmlFor="part-slot"><div className="part-slot-field"><input id="part-slot" className="pn-control" required readOnly autoComplete="off" value={form.slot} placeholder="选择盒位" /><button className="pn-button pn-button--secondary" type="button" disabled={!selectedBox} onClick={() => setSlotPickerOpen((value) => !value)}>选择盒位</button></div>{slotPickerOpen && selectedBox && <div className="part-slot-picker" role="dialog" aria-label="选择盒位">{slots(selectedBox).map((slot) => { const occupied = selectedBox.occupied_slots.includes(slot) && !(editing?.box_id === selectedBox.id && editing.slot === slot); return <button key={slot} className="part-slot-picker__slot" type="button" disabled={occupied} onClick={() => { onChange("slot", slot); setSlotPickerOpen(false); }} aria-label={`${slot} ${occupied ? "已占用" : "空闲"}`}>{slot} {occupied ? "已占用" : "空闲"}</button>; })}</div>}</FormField>
      <FormField label="数量" htmlFor="part-quantity"><input id="part-quantity" className="pn-control" type="number" min="0" inputMode="numeric" autoComplete="off" readOnly={Boolean(editing)} value={quantityText} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onQuantityChange(event.target.value)} /></FormField>
      {field("note", "备注")}
      <div className="pn-form-actions"><button className="pn-button pn-button--primary" type="submit">保存器件</button><CancelButton fallback={onRequestClose}>取消</CancelButton></div>
    </form>
  </Drawer>;
}

function CancelButton({ fallback, children }: { fallback: () => void; children: string }): JSX.Element {
  const requestClose = useOverlayRequestClose();
  return <button className="pn-button pn-button--ghost" type="button" onClick={() => { if (requestClose) void requestClose(); else fallback(); }}>{children}</button>;
}

function RequestCloseBridge({ onReady }: { onReady?: (request: (() => Promise<boolean>) | null) => void }): JSX.Element | null {
  const requestClose = useOverlayRequestClose();
  useEffect(() => {
    onReady?.(requestClose);
    return () => onReady?.(null);
  }, [onReady, requestClose]);
  return null;
}
