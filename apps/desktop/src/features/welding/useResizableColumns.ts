import { useEffect, useRef, useState } from "react";

const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 480;

export function useResizableColumns(defaults: Record<string, number>) {
  const [widths, setWidths] = useState(() => ({ ...defaults }));
  const drag = useRef<{ column: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const current = drag.current;
      if (!current) return;
      const width = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, current.startWidth + event.clientX - current.startX));
      setWidths((previous) => ({ ...previous, [current.column]: width }));
    };
    const end = () => { drag.current = null; };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
    };
  }, []);

  function startResize(column: string, event: React.MouseEvent) {
    event.preventDefault();
    drag.current = { column, startX: event.clientX, startWidth: widths[column] ?? MIN_COLUMN_WIDTH };
  }

  return { widths, startResize, minWidth: MIN_COLUMN_WIDTH, maxWidth: MAX_COLUMN_WIDTH };
}
