import { useEffect, useState } from "react";
import { desktopApi, errorMessage, type DesktopApi, type Movement } from "../../app/tauri";

export type MovementsApi = Pick<DesktopApi, "listMovements" | "reverseTake">;

const quantity = (value: number | null) => value === null ? "—" : String(value);

export function MovementsPage({ api = desktopApi }: { api?: MovementsApi }) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setError("");
      setMovements(await api.listMovements());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  useEffect(() => { void load(); }, [api]);

  async function reverse(movement: Movement) {
    setBusyId(movement.id);
    setError("");
    try {
      await api.reverseTake(movement.id);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return <section aria-label="库存流水">
    {error && <p role="alert">{error}</p>}
    {movements.length === 0 ? <p>暂无流水</p> : <table aria-label="库存流水列表">
      <thead><tr><th>时间</th><th>器件</th><th>变化量</th><th>变化前</th><th>变化后</th><th>原因</th><th>BOM备注名</th><th>操作</th></tr></thead>
      <tbody>{movements.map((movement) => <tr key={movement.id}>
        <td>{movement.created_at}</td>
        <td>{movement.component ?? movement.part_name ?? movement.component_key ?? "—"}</td>
        <td>{movement.delta}</td>
        <td>{quantity(movement.before_quantity)}</td>
        <td>{quantity(movement.after_quantity)}</td>
        <td>{movement.reason}</td>
        <td>{movement.bom_display_name ?? "—"}</td>
        <td>{movement.reversible && <button type="button" disabled={busyId === movement.id} onClick={() => void reverse(movement)}>撤销取用</button>}</td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
