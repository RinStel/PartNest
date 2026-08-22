import type { FieldMapping, FieldName } from "./useBomImport";

const labels: Record<FieldName, string> = {
  quantity: "BOM 数量", designators: "位号", name: "器件", value: "值", package: "封装",
  manufacturer: "制造商", mpn: "MPN", lcsc_code: "LCSC", side: "板面",
};

export function FieldMappingDialog({
  headers, mapping, onChange, onConfirm,
}: {
  headers: string[];
  mapping: FieldMapping;
  onChange: (mapping: FieldMapping) => void;
  onConfirm: () => void;
}) {
  const fields = Object.keys(labels) as FieldName[];
  function setField(field: FieldName, source: string) {
    if (source && fields.some((other) => other !== field && mapping[other] === source)) return;
    onChange({ ...mapping, [field]: source || undefined });
  }
  return <section aria-labelledby="field-mapping-title">
    <h3 id="field-mapping-title">字段映射</h3>
    {fields.map((field) => <label key={field}>{labels[field]}
      <select aria-label={labels[field]} value={mapping[field] ?? ""} onChange={(event) => setField(field, event.target.value)}>
        <option value="">不映射</option>
        {headers.map((header) => <option key={header} value={header} disabled={fields.some((other) => other !== field && mapping[other] === header)}>{header}</option>)}
      </select>
    </label>)}
    <button type="button" onClick={onConfirm}>确认映射</button>
  </section>;
}
