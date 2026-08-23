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

type OverlayEntry = {
  id: symbol;
  element: HTMLDivElement | null;
  order: number;
};

// Overlay lifetime is deliberately scoped to this renderer process. It is not persisted.
const overlayStack: OverlayEntry[] = [];
let nextOverlayOrder = 0;

function registerOverlay(entry: OverlayEntry) {
  unregisterOverlay(entry.id);
  overlayStack.push(entry);
  overlayStack.sort((left, right) => left.order - right.order);
}

function unregisterOverlay(id: symbol) {
  const index = overlayStack.findIndex((entry) => entry.id === id);
  if (index >= 0) overlayStack.splice(index, 1);
}

function isTopmost(id: symbol) {
  return overlayStack.at(-1)?.id === id;
}

function getTopmost() {
  return overlayStack.at(-1) ?? null;
}

function getFocusableElements(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>(focusableSelector)).filter((candidate) => {
    const style = window.getComputedStyle(candidate);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function restoreFocus(previousFocus: HTMLElement | null) {
  const topmost = getTopmost();
  if (topmost) {
    if (previousFocus?.isConnected && topmost.element?.contains(previousFocus)) previousFocus.focus();
    else topmost.element?.focus();
    return;
  }
  if (previousFocus?.isConnected) previousFocus.focus();
  else document.body.focus();
}

function Overlay({ open, title, dirty = false, onRequestClose, confirmDiscard, children, kind }: OverlayProps & { kind: "drawer" | "dialog" }) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  const idRef = useRef<symbol>();
  const orderRef = useRef<number | null>(null);
  const registeredRef = useRef(false);
  const closeAttemptRef = useRef(0);
  const pendingConfirmationRef = useRef(false);
  openRef.current = open;
  if (!idRef.current) idRef.current = Symbol("overlay");
  const id = idRef.current;

  const closeOverlay = useCallback((restore = true) => {
    const wasTopmost = isTopmost(id);
    unregisterOverlay(id);
    registeredRef.current = false;
    wasOpenRef.current = false;
    orderRef.current = null;
    closeAttemptRef.current += 1;
    pendingConfirmationRef.current = false;
    if (restore && wasTopmost) restoreFocus(previousFocusRef.current);
    previousFocusRef.current = null;
  }, [id]);

  useLayoutEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        wasOpenRef.current = true;
        orderRef.current = nextOverlayOrder++;
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      if (!registeredRef.current) {
        registerOverlay({ id, element: overlayRef.current, order: orderRef.current! });
        registeredRef.current = true;
        const firstFocusable = overlayRef.current ? getFocusableElements(overlayRef.current)[0] : null;
        (firstFocusable ?? overlayRef.current)?.focus();
      }
    } else if (!open && wasOpenRef.current) {
      closeOverlay();
    }
  }, [closeOverlay, id, open]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    // React StrictMode performs a simulated cleanup/setup pair. The cleanup
    // unregisters immediately, while this setup preserves the original
    // pre-open focus captured by the first setup.
    return () => {
      mountedRef.current = false;
      unregisterOverlay(id);
      registeredRef.current = false;
      closeAttemptRef.current += 1;
      pendingConfirmationRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          wasOpenRef.current = false;
          previousFocusRef.current = null;
          orderRef.current = null;
        }
      });
    };
  }, [id]);

  const requestClose = useCallback(() => {
    if (!openRef.current || !isTopmost(id) || pendingConfirmationRef.current) return;
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
      if (confirmed && mountedRef.current && openRef.current && isTopmost(id) && attempt === closeAttemptRef.current) onRequestClose();
    };
    if (typeof result === "boolean") finish(result);
    else void result.then(finish, () => finish(false));
  }, [confirmDiscard, dirty, id, onRequestClose]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTopmost(id)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;

    const surface = overlayRef.current;
    if (!surface) return;
    const focusable = getFocusableElements(surface);
    event.preventDefault();
    if (focusable.length === 0) {
      surface.focus();
      return;
    }
    const active = document.activeElement;
    const activeIndex = focusable.indexOf(active as HTMLElement);
    const nextIndex = event.shiftKey
      ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
      : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
    focusable[nextIndex].focus();
  }, [id, requestClose]);

  if (!open) return null;

  return (
    <div
      className={`pn-overlay-backdrop pn-overlay-backdrop--${kind}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget && isTopmost(id)) requestClose(); }}
    >
      <div
        ref={overlayRef}
        className={`pn-overlay pn-overlay--${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
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
