import { useEffect, useState } from "react";
import { Box, desktopApi, DesktopApi, errorMessage } from "../../app/tauri";

export function BoxesPage({ api = desktopApi }: { api?: Pick<DesktopApi, "listBoxes" | "createBox" | "resizeBox"> }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [name, setName] = useState("");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [drafts, setDrafts] = useState<Record<string, { rows: number; cols: number }>>({});
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const result = await api.listBoxes();
      setBoxes(result);
      setDrafts(Object.fromEntries(result.map((box) => [box.id, { rows: box.rows, cols: box.cols }])));
    } catch (cause) { setError(errorMessage(cause)); }
  };
  useEffect(() => { void load(); }, []);

  async function saveBox() {
    setError("");
    if (cols > 100) {
      setError("列数不能超过 100");
      return;
    }
    try {
      const created = await api.createBox({ name, rows, cols });
      setBoxes((current) => [...current, created]);
      setDrafts((current) => ({ ...current, [created.id]: { rows: created.rows, cols: created.cols } }));
      setName("");
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function resize(box: Box) {
    setError("");
    const draft = drafts[box.id] ?? { rows: box.rows, cols: box.cols };
    if (draft.cols > 100) {
      setError("列数不能超过 100");
      return;
    }
    try {
      const updated = await api.resizeBox(box.id, draft.rows, draft.cols);
      setBoxes((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <section aria-labelledby="boxes-title">
    <h2 id="boxes-title">收纳盒</h2>
    <div className="form-row">
      <label>名称 <input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>行 <input type="number" min="1" value={rows} onChange={(event) => setRows(Number(event.target.value))} /></label>
      <label>列 <input type="number" min="1" max="100" value={cols} onChange={(event) => setCols(Number(event.target.value))} /></label>
      <button type="button" onClick={() => void saveBox()}>新建收纳盒</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="box-list">
      {boxes.map((box) => {
        const draft = drafts[box.id] ?? { rows: box.rows, cols: box.cols };
        const occupied = new Set(box.occupied_slots);
        return <article key={box.id} aria-label={box.name}>
          <h3>{box.name}</h3>
          <div className="form-row">
            <label>行 <input type="number" min="1" value={draft.rows} onChange={(event) => setDrafts((current) => ({ ...current, [box.id]: { ...draft, rows: Number(event.target.value) } }))} /></label>
            <label>列 <input type="number" min="1" max="100" value={draft.cols} onChange={(event) => setDrafts((current) => ({ ...current, [box.id]: { ...draft, cols: Number(event.target.value) } }))} /></label>
            <button type="button" onClick={() => void resize(box)}>保存</button>
          </div>
          <div className="box-grid" style={{ gridTemplateColumns: `repeat(${box.cols}, minmax(2rem, 1fr))` }} aria-label={`${box.name}盒位网格`}>
            {Array.from({ length: box.rows * box.cols }, (_, index) => {
              const slot = `${String.fromCharCode(65 + Math.floor(index / box.cols))}${index % box.cols}`;
              return <span key={slot} className={occupied.has(slot) ? "slot occupied" : "slot"} aria-label={`${slot}${occupied.has(slot) ? " 已占用" : " 空闲"}`}>{slot}</span>;
            })}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
