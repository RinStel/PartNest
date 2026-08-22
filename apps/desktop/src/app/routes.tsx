export type RouteId = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings";

export const primaryRoutes: Array<{ id: RouteId; label: string; path: string }> = [
  { id: "inventory", label: "库存", path: "/inventory" },
  { id: "boxes", label: "收纳盒", path: "/boxes" },
  { id: "bom", label: "BOM", path: "/bom" },
  { id: "welding", label: "焊接工作台", path: "/welding" },
  { id: "movements", label: "库存流水", path: "/movements" },
  { id: "settings", label: "设置", path: "/settings" },
];

export function RoutePlaceholder() { return <section aria-label="页面内容" />; }
