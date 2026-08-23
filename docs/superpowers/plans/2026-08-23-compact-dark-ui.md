# PartNest Compact Dark UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PartNest 重构为可在 `1280 × 800 px` 窗口中高效使用的紧凑型深色桌面工具，并修复 `pnpm dev` 的 Tauri/Vite 端口不一致。

**Architecture:** 保留现有 React、Tauri 和业务 API，只重构前端表现层。使用 CSS 变量和小型 React UI 原语建立统一设计系统；各业务页面继续拥有自己的状态和 API 适配器。导航折叠、抽屉开关和列宽只保存在 React 运行时，不增加持久化。

**Tech Stack:** React 18、TypeScript、React Router、Tailwind CSS 3、Vitest、Testing Library、Tauri 2、Vite 6。

**Spec:** `docs/superpowers/specs/2026-08-23-compact-dark-ui-design.md`

## Global Constraints

- 应用自有界面必须使用固定深色主题；交互式 BOM 必须保持原始浅色内容。
- 首期验收窗口为 `1280 × 800 px`；该尺寸不得出现页面级横向滚动、主要操作遮挡或不可访问字段。
- 默认正文为 `13 px`；辅助文字和表格可以使用 `12 px`；常规控件高度约为 `30 px`；顶部工具栏高度为 `40 px`。
- 左侧导航展开宽度约为 `152 px`，折叠宽度约为 `44 px`。
- 导航折叠、抽屉开关、页面筛选和临时列宽不得写入 `localStorage`、Tauri storage 或 SQLite。
- 焊接工作区使用约 `65/35` 的左右布局；iframe 的 sandbox 必须保持为 `allow-scripts`。
- 器件列表列宽范围必须保持为 `72–480 px`，并在组件重新挂载后复位。
- 选择 BOM 器件不得修改库存；只有“确认取用”可以提交扣减。
- UI 文案必须简短；只有操作存在真实歧义或数据风险时才显示说明。
- 不得修改或提交用户的 `需求.md` 移动、用户 BOM 样本、`.superpowers/` 或 `apps/desktop/src-tauri/gen/`。
- 可以在当前 `master` 创建本地提交；不得推送。

---

### Task 1: 深色设计令牌、UI 原语和开发端口

**Files:**
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/styles/tokens.css`
- Create: `apps/desktop/src/styles/primitives.css`
- Create: `apps/desktop/src/components/ui/Icon.tsx`
- Create: `apps/desktop/src/components/ui/PageToolbar.tsx`
- Create: `apps/desktop/src/components/ui/Overlay.tsx`
- Create: `apps/desktop/src/components/ui/StatusBadge.tsx`
- Create: `apps/desktop/src/components/ui/ui-primitives.test.tsx`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/components/ui/button.tsx`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Produces: `Icon`、`PageToolbar`、`Drawer`、`Dialog`、`StatusBadge` 和统一 CSS 类。
- Produces: Vite 固定监听 `127.0.0.1:1420`，与 Tauri `devUrl` 一致。

```ts
export type IconName = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings" | "menu";
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "active";
export type OverlayProps = {
  open: boolean;
  title: string;
  dirty?: boolean;
  onRequestClose: () => void;
  confirmDiscard?: () => boolean | Promise<boolean>;
  children: React.ReactNode;
};
export function Drawer(props: OverlayProps): JSX.Element | null;
export function Dialog(props: OverlayProps): JSX.Element | null;
export function PageToolbar(props: { title: string; actions?: React.ReactNode }): JSX.Element;
export function StatusBadge(props: { tone: StatusTone; children: React.ReactNode }): JSX.Element;
```

- [ ] **Step 1: 写入 UI 原语和端口配置失败测试**

```tsx
it("closes a drawer with Escape and restores focus", async () => {
  render(<Drawer open title="编辑器件" onRequestClose={onClose}><button>保存</button></Drawer>);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});

it("uses the compact control contract", () => {
  render(<StatusBadge tone="warning">缺料</StatusBadge>);
  expect(screen.getByText("缺料")).toHaveAttribute("data-tone", "warning");
});
```

测试还必须读取 `vite.config.ts` 和 `tauri.conf.json`，断言两者使用端口 `1420`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- ui-primitives.test.tsx`

Expected: FAIL，因为 UI 原语和 `vite.config.ts` 尚不存在。

- [ ] **Step 3: 实现令牌和 UI 原语**

令牌至少包含以下语义变量：

```css
:root {
  color-scheme: dark;
  --bg-app: #11151b;
  --bg-panel: #181e26;
  --bg-raised: #202833;
  --border: #313b48;
  --text: #e6eaf0;
  --text-muted: #98a3b3;
  --accent: #4f8cff;
  --danger: #e45d68;
  --control-height: 30px;
  --toolbar-height: 40px;
}
```

`Drawer` 和 `Dialog` 必须提供 `role="dialog"`、标题关联、Escape 关闭和打开时的初始焦点。关闭前如果表单报告 dirty 状态，组件必须调用页面提供的确认回调，不得自行丢弃输入。

- [ ] **Step 4: 统一开发端口**

```ts
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
});
```

Tauri `devUrl` 必须改为 `http://127.0.0.1:1420`。测试必须防止主机或端口再次漂移。

- [ ] **Step 5: 验证并提交**

Run: `pnpm --filter @partnest/desktop test -- ui-primitives.test.tsx`

Run: `.\node_modules\.bin\tsc.CMD -p apps/desktop/tsconfig.json --noEmit`

Expected: UI 原语和端口契约测试通过，TypeScript 无诊断。

Commit: `feat: add compact dark UI foundation`

### Task 2: 应用框架和可折叠导航

**Files:**
- Create: `apps/desktop/src/app/AppShell.tsx`
- Create: `apps/desktop/src/app/AppShell.test.tsx`
- Create: `apps/desktop/src/styles/shell.css`
- Modify: `apps/desktop/src/app/App.tsx`
- Modify: `apps/desktop/src/app/routes.tsx`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/app/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Icon`、`PageToolbar` 和主题令牌。
- Produces: `AppShell`、`PageToolbar` 页面结构和当前运行周期内的导航折叠状态。

- [ ] **Step 1: 写入框架失败测试**

```tsx
it("collapses navigation without persistence", async () => {
  const { unmount } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "折叠导航" }));
  expect(screen.getByTestId("app-shell")).toHaveAttribute("data-nav", "collapsed");
  expect(localStorage.setItem).not.toHaveBeenCalled();
  unmount();
  render(<App />);
  expect(screen.getByTestId("app-shell")).toHaveAttribute("data-nav", "expanded");
});
```

测试还必须断言折叠导航保留可访问名称，当前路由在 `40 px` 页面工具栏中显示，页面不再重复显示同级大标题。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- AppShell.test.tsx App.test.tsx`

Expected: FAIL，因为现有 Shell 没有折叠状态和统一页面工具栏。

- [ ] **Step 3: 实现 AppShell**

`AppShell` 使用局部 `useState(true)` 管理展开状态。路由元数据增加图标标识，但不得引入新的图标依赖。CSS Grid 必须使用 `44 px/152 px + minmax(0, 1fr)`，避免内容撑出窗口。

- [ ] **Step 4: 验证布局和完整前端回归**

Run: `pnpm --filter @partnest/desktop test -- AppShell.test.tsx App.test.tsx`

Run: `pnpm --filter @partnest/desktop test`

Expected: 导航展开、折叠、重新挂载复位和路由测试全部通过。

- [ ] **Step 5: 提交**

Commit: `feat: add compact desktop shell`

### Task 3: 库存表格、器件抽屉和盒位分栏

**Files:**
- Create: `apps/desktop/src/components/ui/DataTable.tsx`
- Create: `apps/desktop/src/components/ui/FormField.tsx`
- Create: `apps/desktop/src/features/inventory/PartDrawer.tsx`
- Create: `apps/desktop/src/features/boxes/BoxDialog.tsx`
- Create: `apps/desktop/src/styles/inventory.css`
- Modify: `apps/desktop/src/features/inventory/InventoryPage.tsx`
- Modify: `apps/desktop/src/features/inventory/InventoryPage.test.tsx`
- Modify: `apps/desktop/src/features/boxes/BoxesPage.tsx`
- Modify: `apps/desktop/src/features/boxes/BoxesPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Drawer`、`Dialog`、`StatusBadge`；Task 2 `PageToolbar`。
- Produces: 通用 `DataTable`、`FormField`、库存抽屉和盒位分栏布局。

```ts
export type DataColumn<Row> = {
  id: string;
  header: string;
  width?: number | string;
  cell: (row: Row) => React.ReactNode;
};
export function DataTable<Row>(props: {
  label: string;
  rows: Row[];
  columns: DataColumn<Row>[];
  rowKey: (row: Row) => string;
  emptyText: string;
}): JSX.Element;
export function FormField(props: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}): JSX.Element;
```

- [ ] **Step 1: 写入库存和盒位布局失败测试**

```tsx
it("opens the complete part form in a drawer", async () => {
  render(<InventoryPage api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "新增器件" }));
  expect(screen.getByRole("dialog", { name: "新增器件" })).toBeVisible();
  for (const label of ["名称", "分类", "封装", "制造商", "MPN", "LCSC", "收纳盒", "盒位", "数量", "备注"])
    expect(screen.getByLabelText(label)).toBeVisible();
});
```

盒位测试必须断言左侧只显示盒子列表，右侧只显示当前盒子的槽位网格；占用槽位同时显示文字状态和数量/器件信息。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- InventoryPage.test.tsx BoxesPage.test.tsx`

Expected: FAIL，因为表单仍直接铺在页面中，盒位仍逐卡片展开。

- [ ] **Step 3: 实现库存页面**

库存表格列固定为：名称、分类、封装、制造商、MPN、LCSC、盒位、库存、操作。库存调整使用行内紧凑控件；元数据编辑使用 `PartDrawer`。删除必须继续调用现有安全 API，不得绕过审计约束。

- [ ] **Step 4: 实现盒位页面**

左侧列表宽度使用 `clamp(12rem, 22vw, 18rem)`；右侧槽位网格使用 `minmax(3.25rem, 1fr)`。新增/编辑进入 `BoxDialog`。删除前显示确认弹窗，并保留后端占用检查错误。

- [ ] **Step 5: 验证并提交**

Run: `pnpm --filter @partnest/desktop test -- InventoryPage.test.tsx BoxesPage.test.tsx`

Run: `pnpm --filter @partnest/desktop build`

Expected: 页面测试和构建通过；`1280 × 800 px` 宽度类测试没有页面级溢出。

Commit: `feat: redesign inventory and box workspace`

### Task 4: BOM 导入工具栏、映射弹窗和分析表格

**Files:**
- Create: `apps/desktop/src/styles/bom.css`
- Modify: `apps/desktop/src/features/bom/BomImportPage.tsx`
- Modify: `apps/desktop/src/features/bom/FieldMappingDialog.tsx`
- Modify: `apps/desktop/src/features/bom/BomAnalysisTable.tsx`
- Modify: `apps/desktop/src/features/bom/BomImportPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Dialog`、`StatusBadge`；Task 2 `PageToolbar`；Task 3 `DataTable`、`FormField`。
- Produces: 单行 BOM 导入工具栏、条件映射弹窗和紧凑分析表格。

- [ ] **Step 1: 写入导入工作流失败测试**

```tsx
it("keeps import controls in the toolbar and opens mapping as a dialog", async () => {
  render(<BomImportPage api={api} pickFile={pickFile} />);
  expect(screen.getByRole("toolbar", { name: "BOM 操作" })).toContainElement(screen.getByRole("button", { name: "选择文件" }));
  fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
  expect(await screen.findByRole("dialog", { name: "字段映射" })).toBeVisible();
});
```

测试必须覆盖备注名、取消映射、重复字段禁用、候选匹配状态标签和缺料值。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- BomImportPage.test.tsx`

Expected: FAIL，因为字段映射目前是普通 section，页面没有工具栏结构。

- [ ] **Step 3: 实现 BOM 页面**

工具栏仅显示备注名、文件名/选择文件和导入状态。`FieldMappingDialog` 使用 Task 1 `Dialog`，不得在 `Ready` 状态保留。分析表格使用状态标签，不增加“确认前不会修改库存”等说明文案。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @partnest/desktop test -- BomImportPage.test.tsx`

Run: `.\node_modules\.bin\tsc.CMD -p apps/desktop/tsconfig.json --noEmit`

Expected: 导入、映射、匹配和缺料测试通过。

Commit: `feat: redesign BOM analysis workspace`

### Task 5: 深色焊接工作台和底部器件列表

**Files:**
- Create: `apps/desktop/src/styles/welding.css`
- Create: `apps/desktop/src/features/welding/ComponentTray.tsx`
- Modify: `apps/desktop/src/features/welding/WeldingPage.tsx`
- Modify: `apps/desktop/src/features/welding/TakePanel.tsx`
- Modify: `apps/desktop/src/features/welding/BomFrame.tsx`
- Modify: `apps/desktop/src/features/welding/WeldingPage.test.tsx`
- Modify: `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: Task 1 `StatusBadge`；Task 2 `PageToolbar`；Task 3 `DataTable`。
- Produces: `65/35` 焊接主布局、浅色 BOM 画布、独立板面状态和可折叠 `ComponentTray`。

```ts
export type ComponentTrayProps = {
  group: BomGroup;
  side: BomSide | "all";
  designators: string[];
  widths: Record<string, number>;
  onResizeStart: (column: string, event: React.MouseEvent) => void;
  onResizeKey: (column: string, delta: number) => void;
};
export function ComponentTray(props: ComponentTrayProps): JSX.Element;
```

- [ ] **Step 1: 写入布局和业务边界失败测试**

```tsx
it("keeps the light BOM canvas inside the dark 65/35 workspace", async () => {
  render(<WeldingPage api={api} />);
  const frame = await screen.findByTitle("交互式 BOM");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  expect(frame.closest("[data-bom-canvas]")).toHaveClass("bom-canvas-light");
  expect(screen.getByTestId("welding-layout")).toHaveAttribute("data-split", "65-35");
});
```

现有测试必须继续覆盖：选择不扣库存、数量可编辑、失败保留输入、顶/底面独立、`all` 不提交、消息来源校验和列宽重新挂载复位。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- WeldingPage.test.tsx`

Expected: FAIL，因为当前器件列表位于右侧且没有折叠托盘或深浅画布边界。

- [ ] **Step 3: 实现工作台布局**

主区域使用：

```css
.welding-layout { grid-template-columns: minmax(0, 13fr) minmax(19rem, 7fr); }
.bom-canvas-light { background: #f6f7f8; border: 1px solid var(--border-strong); }
```

右侧只保留板面切换、选择摘要和 `TakePanel`。`ComponentTray` 放在主区域底部，折叠状态使用局部 `useState`。不得向 iframe 注入深色样式。

- [ ] **Step 4: 精简取用面板**

面板只显示器件、盒位、库存、位号、BOM 数量、取用数量和“确认取用（−N）”。顶/底面状态同时显示文字和状态标签。错误必须保持行内显示并保留数量输入。

- [ ] **Step 5: 验证并提交**

Run: `pnpm --filter @partnest/desktop test -- WeldingPage.test.tsx`

Run: `pnpm --filter @partnest/desktop test`

Expected: 焊接专项和完整前端测试通过。

Commit: `feat: redesign welding workspace`

### Task 6: 流水、设置、响应式验收和一键启动

**Files:**
- Create: `apps/desktop/src/styles/operations.css`
- Create: `apps/desktop/src/test/layout-contract.test.tsx`
- Modify: `apps/desktop/src/features/movements/MovementsPage.tsx`
- Modify: `apps/desktop/src/features/movements/MovementsPage.test.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPage.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/desktop/src/styles.css`
- Modify: `scripts/verify.ps1`

**Interfaces:**
- Consumes: Tasks 1–5 的主题、应用框架、表格和状态组件。
- Produces: 完整深色页面覆盖、`1280 × 800 px` 布局契约和最终验证入口。

- [ ] **Step 1: 写入流水和设置失败测试**

流水测试必须断言筛选工具栏、固定列顺序、状态标签和唯一可撤销行。设置测试必须断言只有“数据与备份”和“界面”两个分组，且不显示大卡片或通用教学句。

- [ ] **Step 2: 写入布局契约测试**

```tsx
it("keeps every route inside the compact desktop viewport contract", () => {
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  render(<App />);
  expect(screen.getByTestId("app-shell")).toHaveClass("compact-desktop-shell");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});
```

测试不得把 jsdom 的零布局尺寸当成真实像素测量。像素约束通过稳定的 CSS 类、变量值和 Playwright/Tauri 手工验收共同验证。

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm --filter @partnest/desktop test -- MovementsPage.test.tsx SettingsPage.test.tsx layout-contract.test.tsx`

Expected: FAIL，因为页面尚未使用统一工具栏/分组，且没有全局布局契约。

- [ ] **Step 4: 实现流水和设置页面**

流水表格使用统一 `DataTable`。撤销按钮保持次要样式，后端判定不可撤销时不得渲染。设置页只显示两个紧凑分组；备份路径作为状态文本显示，恢复风险保留一句明确提示。

- [ ] **Step 5: 扩展统一验证脚本**

在现有命令顺序中保留全部业务门禁，并在 Tauri build 之前增加显式 TypeScript 检查。不得删除现有 Rust 测试、fmt、Tauri build 或 `git diff --check`。

- [ ] **Step 6: 执行完整自动验证**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`

Run: `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: 前端测试、TypeScript、前端构建、Rust 测试、fmt、Tauri release build、clippy 和 diff check 全部通过。

- [ ] **Step 7: 验证开发启动**

Run: `pnpm dev`

Expected: Vite 在 `127.0.0.1:1420` 启动；Tauri 不再等待错误端口；应用窗口打开。人工检查 `1280 × 800 px` 下的导航折叠、库存抽屉、盒位分栏、BOM 映射、焊接 `65/35` 布局、流水和设置。

- [ ] **Step 8: 清理并提交**

只删除本次构建生成且已确认路径为 `apps/desktop/src-tauri/gen/` 的未跟踪文件。不得删除用户文件。

Commit: `feat: complete compact dark desktop UI`

## Release Gates

以下门槛不属于本计划的自动通过项，必须继续标记为 **UNVERIFIED**：

- Windows 10 完整人工业务流程；
- Windows 11 自动和人工验收；
- 真实 EasyEDA 导出 HTML 的 DOM 差异；
- 真实用户 BOM 原文件哈希保留。
