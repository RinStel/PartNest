import type { CSSProperties, ReactNode } from "react";

export function PageToolbar({ title, actions }: { title: string; actions?: ReactNode }): JSX.Element {
  return (
    <div className="pn-toolbar" role="toolbar" aria-label={`${title}工具栏`} style={{ "--toolbar-height": "40px" } as CSSProperties}>
      <h1 className="pn-toolbar__title">{title}</h1>
      {actions && <div className="pn-toolbar__actions">{actions}</div>}
    </div>
  );
}
