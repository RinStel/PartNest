import { type RefObject } from "react";

export function BomFrame({ src, frameRef }: { src: string; frameRef: RefObject<HTMLIFrameElement> }) {
  return <iframe ref={frameRef} src={src} sandbox="allow-scripts" title="交互式 BOM" />;
}
