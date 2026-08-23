import { Dialog } from "../../components/ui/Overlay";
import { FormField } from "../../components/ui/FormField";

export type BoxDraft = { name: string; rows: number; cols: number };

export function BoxDialog({ open, editing, dirty = false, draft, error, onChange, onSave, onRequestClose }: {
  open: boolean;
  editing: boolean;
  dirty?: boolean;
  draft: BoxDraft;
  error?: string;
  onChange: (field: keyof BoxDraft, value: string | number) => void;
  onSave: () => void;
  onRequestClose: () => void;
}): JSX.Element | null {
  return <Dialog open={open} title={editing ? "编辑收纳盒" : "新增收纳盒"} dirty={dirty} confirmDiscard={() => window.confirm("放弃未保存更改？")} onRequestClose={onRequestClose}>
    <form className="pn-dialog-form" noValidate onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      {error && <p className="pn-inline-error" role="alert">{error}</p>}
      <FormField label="名称" htmlFor="box-name"><input id="box-name" className="pn-control" required value={draft.name} onChange={(event) => onChange("name", event.target.value)} /></FormField>
      <FormField label="行" htmlFor="box-rows"><input id="box-rows" className="pn-control" type="number" min="1" required value={draft.rows} onChange={(event) => onChange("rows", Number(event.target.value))} /></FormField>
      <FormField label="列" htmlFor="box-cols"><input id="box-cols" className="pn-control" type="number" min="1" max="100" required value={draft.cols} onChange={(event) => onChange("cols", Number(event.target.value))} /></FormField>
      <div className="pn-form-actions"><button className="pn-button pn-button--primary" type="submit">保存</button><button className="pn-button pn-button--ghost" type="button" onClick={onRequestClose}>取消</button></div>
    </form>
  </Dialog>;
}
