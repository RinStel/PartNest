import type { ReactNode } from "react";

export type DataColumn<Row> = {
  id: string;
  header: string;
  width?: number | string;
  cell: (row: Row) => ReactNode;
};

export function DataTable<Row>({ label, rows, columns, rowKey, emptyText }: {
  label: string;
  rows: Row[];
  columns: DataColumn<Row>[];
  rowKey: (row: Row) => string;
  emptyText: string;
}): JSX.Element {
  return <div className="pn-table-wrap">
    <table className="pn-data-table" aria-label={label}>
      <colgroup>{columns.map((column) => <col key={column.id} style={{ width: typeof column.width === "number" ? `${column.width}px` : column.width }} />)}</colgroup>
      <thead><tr>{columns.map((column) => <th key={column.id} scope="col">{column.header}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td className="pn-data-table__empty" colSpan={columns.length}>{emptyText}</td></tr> : rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.id}>{column.cell(row)}</td>)}</tr>)}
      </tbody>
    </table>
  </div>;
}
