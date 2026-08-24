import type { ReactNode } from "react";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "active";

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }): JSX.Element {
  return <span className="pn-status-badge" data-tone={tone} role="status" aria-label={typeof children === "string" ? children : undefined}>{children}</span>;
}
