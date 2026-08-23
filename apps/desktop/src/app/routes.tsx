export type RouteId = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings";

import type { IconName } from "../components/ui/Icon";

export interface PrimaryRoute {
  id: RouteId;
  label: string;
  path: string;
  title: string;
  icon: IconName;
}

export const primaryRoutes: PrimaryRoute[] = [
  { id: "inventory", label: "库存", title: "库存管理", path: "/inventory", icon: "inventory" },
  { id: "boxes", label: "收纳盒", title: "收纳盒", path: "/boxes", icon: "boxes" },
  { id: "bom", label: "BOM", title: "BOM 分析", path: "/bom", icon: "bom" },
  { id: "welding", label: "焊接工作台", title: "焊接工作台", path: "/welding", icon: "welding" },
  { id: "movements", label: "库存流水", title: "库存流水", path: "/movements", icon: "movements" },
  { id: "settings", label: "设置", title: "设置", path: "/settings", icon: "settings" },
];

export function RoutePlaceholder() { return <section aria-label="页面内容" />; }
