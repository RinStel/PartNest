import type { MouseEvent } from "react";
import type { BomGroup, BomSide } from "../../app/tauri";

export type ComponentTrayProps = {
  groups: BomGroup[];
  side: BomSide | "all";
  activeComponentKey: string | null;
  widths: Record<string, number>;
  onResizeStart: (column: string, event: MouseEvent) => void;
  onResizeKey: (column: string, delta: number) => void;
  collapsed: boolean;
  onToggle: () => void;
};

const columns = [
  ["component", "器件"],
  ["package", "封装"],
  ["quantity", "数量"],
  ["side", "板面"],
] as const;

function groupDesignators(group: BomGroup, side: BomSide | "all") {
  if (side === "all") return group.designators;
  return group.placements.filter((placement) => placement.side === side).map((placement) => placement.designator);
}

export function ComponentTray({ groups, side, activeComponentKey, widths, onResizeStart, onResizeKey, collapsed, onToggle }: ComponentTrayProps) {
  const resizeButton = (column: string, label: string) => <button
    type="button"
    role="separator"
    aria-label={`调整${label}列宽`}
    aria-valuemin={72}
    aria-valuemax={480}
    aria-valuenow={widths[column]}
    tabIndex={0}
    onMouseDown={(event) => onResizeStart(column, event)}
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        onResizeKey(column, event.key === "ArrowLeft" ? -8 : 8);
      }
    }}
  >↔</button>;

  return <section className="component-tray" aria-label="器件列表" data-collapsed={collapsed ? "true" : "false"}>
    <header className="component-tray__header">
      <h3>器件列表</h3>
      <button type="button" className="pn-button pn-button--ghost" aria-expanded={!collapsed} aria-label={collapsed ? "展开器件列表" : "收起器件列表"} onClick={onToggle}>{collapsed ? "展开" : "收起"}</button>
    </header>
    {!collapsed && <div className="component-tray__table" role="table" aria-label="BOM 器件" data-scroll-container="true">
      <div className="component-tray__row" role="row">
        {columns.map(([column, label]) => <div className="component-tray__cell component-tray__header-cell" role="columnheader" key={column} data-testid={column === "component" ? "component-column" : undefined} style={{ width: widths[column] }}>
          {label} {resizeButton(column, label)}
        </div>)}
      </div>
      {groups.map((group) => {
        const designators = groupDesignators(group, side);
        return <div className="component-tray__row" role="row" key={group.component_key} data-testid={`tray-row-${group.component_key}`} data-active={group.component_key === activeComponentKey ? "true" : "false"}>
          <div className="component-tray__cell" role="cell" data-testid={group.component_key === activeComponentKey ? "component-cell" : undefined} style={{ width: widths.component }}>{group.name || group.value}</div>
          <div className="component-tray__cell" role="cell" style={{ width: widths.package }}>{group.package || "—"}</div>
          <div className="component-tray__cell" role="cell" style={{ width: widths.quantity }}>{designators.length}</div>
          <div className="component-tray__cell" role="cell" style={{ width: widths.side }}>{side === "all" ? "双面" : side === "top" ? "顶层" : "底层"}</div>
        </div>;
      })}
      {!groups.length && <p className="component-tray__empty">暂无器件</p>}
    </div>}
  </section>;
}
