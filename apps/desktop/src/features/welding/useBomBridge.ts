import { useLayoutEffect, type RefObject } from "react";
import type { CachedBomSession, ResolvedBomSelection } from "../../app/tauri";

type BridgeApi = Pick<import("../../app/tauri").DesktopApi, "resolveBomSelection">;

/** 宿主每秒接受一个 BOM 文档发来的消息数上限（该文档不可信）。 */
const MAX_MESSAGES_PER_SECOND = 8;
const MAX_DESIGNATORS = 512;

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
    let lastSignature = "";
    let stamps: number[] = [];
    const listen = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      if (data.type !== "partnest:bom-selection" || data.token !== session.token || !Array.isArray(data.designators)) return;
      const designators = data.designators as unknown[];
      if (!designators.length || designators.length > MAX_DESIGNATORS || designators.some((value) => typeof value !== "string" || !value || value.trim() !== value || value.length > 64)) return;
      // 不可信文档内部的去重不可依赖：被篡改的 BOM 可以来回交替上报选择，
      // 让每条消息都排在数据库锁后面排队执行。
      const signature = designators.join("\u0000");
      if (signature === lastSignature) return;
      const now = Date.now();
      stamps = stamps.filter((stamp) => now - stamp < 1000);
      if (stamps.length >= MAX_MESSAGES_PER_SECOND) return;
      stamps.push(now);
      lastSignature = signature;
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
