import type { SVGProps } from "react";

export type IconName = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings" | "menu";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  title?: string;
}

export function BrandMark({ size = 20 }: { size?: number }) {
  return <svg className="pn-brand-mark" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="PartNest" focusable="false">
    <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity=".18" />
    <path d="M7 8.5 12 6l5 2.5v7L12 18l-5-2.5v-7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m7 8.5 5 2.5 5-2.5M12 11v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="7" cy="6" r="1" fill="currentColor" /><circle cx="17" cy="6" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>;
}

const paths: Record<IconName, JSX.Element> = {
  inventory: <><path d="M3 21V8l9-5 9 5v13" /><path d="M3 13h18M8 21v-4h8v4" /></>,
  boxes: <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z" /><path d="m4 7 8 4 8-4M12 11v10" /><path d="M8 5l8 4" /></>,
  bom: <><path d="M6 3h10l3 3v15H6V3Z" /><path d="M16 3v4h4M9 11h6M9 15h6M9 19h4" /></>,
  welding: <><path d="m14 5 5 5-7 7-5-5 7-7Z" /><path d="m6 13-3 8 8-3M15 4l2-2M18 7l2-2" /><path d="m9 15 2 2" /></>,
  movements: <><path d="M7 7h11l-3-3M17 17H6l3 3" /><path d="M18 7l-3 3M6 17l3-3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20.3h-3v-.08A1.7 1.7 0 0 0 10.66 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.92a1.7 1.7 0 0 0-.34-1.88l-.06-.06L8.72 5.86l.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 9.92a1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

export function Icon({ name, size = 16, title, ...props }: IconProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  );
}
