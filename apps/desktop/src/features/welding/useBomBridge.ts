import { useLayoutEffect, type RefObject } from "react";
import type { CachedBomSession, ResolvedBomSelection } from "../../app/tauri";

type BridgeApi = Pick<import("../../app/tauri").DesktopApi, "resolveBomSelection">;

export function useBomBridge({
  frameRef,
  session,
  api,
  onResolved,
  onError,
}: {
  frameRef: RefObject<HTMLIFrameElement>;
  session: CachedBomSession | null;
  api: BridgeApi;
  onResolved: (selection: ResolvedBomSelection) => void;
  onError: (error: unknown) => void;
}) {
  useLayoutEffect(() => {
    if (!session) return;
    let sequence = 0;
    let disposed = false;
    const listen = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      if (data.type !== "partnest:bom-selection" || data.token !== session.token || !Array.isArray(data.designators)) return;
      const designators = data.designators as unknown[];
      if (!designators.length || designators.length > 512 || designators.some((value) => typeof value !== "string" || !value || value.trim() !== value || value.length > 64)) return;
      const request = ++sequence;
      void api.resolveBomSelection(session.token, designators as string[]).then((resolved) => {
        if (!disposed && request === sequence) onResolved(resolved);
      }).catch((error) => {
        if (!disposed && request === sequence) onError(error);
      });
    };
    window.addEventListener("message", listen);
    return () => { disposed = true; window.removeEventListener("message", listen); };
  }, [api, frameRef, onError, onResolved, session]);
}
