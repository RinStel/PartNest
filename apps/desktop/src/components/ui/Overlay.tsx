import { useCallback, useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export type OverlayProps = {
  open: boolean;
  title: string;
  dirty?: boolean;
  onRequestClose: () => void;
  confirmDiscard?: () => boolean | Promise<boolean>;
  children: ReactNode;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function Overlay({ open, title, dirty = false, onRequestClose, confirmDiscard, children, kind }: OverlayProps & { kind: "drawer" | "dialog" }) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  const closeAttemptRef = useRef(0);
  const pendingConfirmationRef = useRef(false);
  openRef.current = open;

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const firstFocusable = overlayRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? overlayRef.current)?.focus();
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      closeAttemptRef.current += 1;
      pendingConfirmationRef.current = false;
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeAttemptRef.current += 1;
    };
  }, []);

  const requestClose = useCallback(() => {
    if (!openRef.current || pendingConfirmationRef.current) return;
    if (!dirty) {
      onRequestClose();
      return;
    }
    if (!confirmDiscard) return;

    pendingConfirmationRef.current = true;
    const attempt = ++closeAttemptRef.current;
    let result: boolean | Promise<boolean>;
    try {
      result = confirmDiscard();
    } catch {
      pendingConfirmationRef.current = false;
      return;
    }

    const finish = (confirmed: boolean) => {
      pendingConfirmationRef.current = false;
      if (confirmed && mountedRef.current && openRef.current && attempt === closeAttemptRef.current) onRequestClose();
    };
    if (typeof result === "boolean") finish(result);
    else void result.then(finish, () => finish(false));
  }, [confirmDiscard, dirty, onRequestClose]);

  if (!open) return null;

  return (
    <div
      className={`pn-overlay-backdrop pn-overlay-backdrop--${kind}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <div
        ref={overlayRef}
        className={`pn-overlay pn-overlay--${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            requestClose();
          }
        }}
      >
        <header className="pn-overlay__header">
          <h2 id={titleId} className="pn-overlay__title">{title}</h2>
          <button type="button" className="pn-button pn-button--icon pn-button--ghost" aria-label="关闭" onClick={requestClose}>×</button>
        </header>
        <div className="pn-overlay__body">{children}</div>
      </div>
    </div>
  );
}

export function Drawer(props: OverlayProps): JSX.Element | null {
  return <Overlay {...props} kind="drawer" />;
}

export function Dialog(props: OverlayProps): JSX.Element | null {
  return <Overlay {...props} kind="dialog" />;
}
