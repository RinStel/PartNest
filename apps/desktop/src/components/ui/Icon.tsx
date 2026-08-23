import type { SVGProps } from "react";

export type IconName = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings" | "menu";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  title?: string;
}

const paths: Record<IconName, JSX.Element> = {
  inventory: <path d="M4 5.5 12 3l8 2.5v13L12 21l-8-2.5v-13Zm8-2.5v18m-8-15 8 2.5L20 6M4 12l8 2.5 8-2.5" />,
  boxes: <path d="m3.5 7 8.5-4 8.5 4v10l-8.5 4-8.5-4V7Zm8.5-4v8m8.5-4-8.5 4-8.5-4M7 9.5v5l5 2.5 5-2.5v-5" />,
  bom: <path d="M5 3h14v18H5V3Zm3 4h8M8 11h8M8 15h5" />,
  welding: <path d="m5 19 5.5-5.5m-1-5L14 4l6 6-4.5 4.5M5 19l4 1 1-4-4-1-1 4Zm7-12 2 2m-4 2 2 2" />,
  movements: <path d="M5 7h12m0 0-3-3m3 3-3 3M19 17H7m0 0 3-3m-3 3 3 3" />,
  settings: <path d="m12 3 1.2 2.5 2.7.5 1.9-1.6 2.1 2.1-1.6 1.9.5 2.7L21 12l-2.2 1.2-.5 2.7 1.6 1.9-2.1 2.1-1.9-1.6-2.7.5L12 21l-1.2-2.2-2.7-.5-1.9 1.6-2.1-2.1 1.6-1.9-.5-2.7L3 12l2.2-1.2.5-2.7-1.6-1.9 2.1-2.1 1.9 1.6 2.7-.5L12 3Zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />,
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
