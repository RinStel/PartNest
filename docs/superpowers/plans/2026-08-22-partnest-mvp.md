# PartNest MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可在 Windows 10/11 使用的 PartNest 桌面应用，完成库存和盒位管理、BOM 导入与匹配、交互式 BOM 联动、双面取用、库存流水和数据库备份。

**Architecture:** React 主界面通过受限 Tauri command 调用 Rust 后端。Rust 后端独占 SQLite、文件缓存和 BOM 解析；导入的交互式 BOM 在无 Tauri 权限的 sandbox iframe 中运行，只通过带会话令牌的 `postMessage` 上报选择事件。

**Tech Stack:** Tauri 2、Rust、React、TypeScript、Vite、shadcn/ui、Tailwind CSS、SQLite、pnpm workspace、Vitest、React Testing Library、rusqlite、calamine、csv、serde_json。

**Spec:** `docs/superpowers/specs/2026-08-22-partnest-design.md`

## Global Constraints

- 首期验收平台是 Windows 10/11；业务规则不得依赖 Windows API。
- `partnest.db` 是唯一业务事实来源；BOM 明细不得写入数据库。
- 原始 BOM 文件必须保持不变；只修改缓存副本。
- 导入的 HTML 视为不可信内容，不得获得库存和数据库 command 权限。
- 只有“确认取用”可以扣减库存；选中器件不得修改库存。
- 顶层和底层必须独立记录；`all` 只表示界面汇总。
- 库存不得小于 `0`；扣减、流水和进度更新必须使用同一事务。
- 器件列表列宽只保存在 React 当前运行状态中。
- 界面文案必须简短；只在存在歧义、冲突或不可逆后果时解释。
- CSV 必须支持逗号和制表符分隔，并支持 UTF-8、UTF-8 BOM 和 UTF-16LE BOM。
- 不得提交用户提供的 BOM 原文件。每个提交步骤只有在用户明确授权本地提交后才执行；不得推送。

## Target File Structure

```text
apps/desktop/
  src/app/                 路由、布局和 Tauri command 封装
  src/features/boxes/      收纳盒界面
  src/features/inventory/  库存界面
  src/features/bom/        BOM 导入、字段映射和缺料分析
  src/features/welding/    焊接工作台和桥接监听
  src/features/movements/  库存流水
  src-tauri/migrations/    SQLite 迁移
  src-tauri/src/bom/       BOM 解析、缓存和桥接校验
  src-tauri/src/commands/  Tauri commands
  src-tauri/src/db/        连接、事务和 repository
  src-tauri/src/backup.rs  一致性备份
packages/domain/src/       BOM、匹配和焊接规则
packages/domain/tests/     TypeScript 领域测试
fixtures/bom/              可提交的最小脱敏测试样例
```

---

### Task 1: Workspace 与桌面壳

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/desktop/**`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Test: `apps/desktop/src/app/App.test.tsx`

**Interfaces:**
- Consumes: 无。
- Produces: `@partnest/domain` workspace package；`pnpm dev`、`pnpm test`、`pnpm build` 根命令；Tauri `main` 窗口。

- [ ] **Step 1: 创建 pnpm workspace 和 Tauri 2 React TypeScript 项目**

Run:

```powershell
pnpm create tauri-app@latest apps/desktop --template react-ts --manager pnpm --tauri-version 2
pnpm add -D -w typescript vitest
pnpm --dir apps/desktop add react-router-dom @tauri-apps/plugin-dialog zod
pnpm --dir apps/desktop add -D @testing-library/react @testing-library/jest-dom jsdom
```

在根 `package.json` 中定义：

```json
{
  "name": "partnest",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "dev": "pnpm --filter @partnest/desktop tauri dev",
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

- [ ] **Step 2: 写入应用壳失败测试**

```tsx
it("shows the six primary destinations", () => {
  render(<App />);
  for (const label of ["库存", "收纳盒", "BOM", "焊接工作台", "库存流水", "设置"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});
```

Run: `pnpm --filter @partnest/desktop test -- App.test.tsx`

Expected: FAIL，因为 `App` 尚未提供主导航。

- [ ] **Step 3: 实现最小路由和主布局**

创建 `src/app/routes.tsx`，使用以下路由 ID：

```ts
export type RouteId = "inventory" | "boxes" | "bom" | "welding" | "movements" | "settings";
```

创建 `src/app/App.tsx`，显示六个入口和 `<Outlet />`。运行 shadcn 初始化：

```powershell
pnpm --dir apps/desktop dlx shadcn@latest init --defaults
```

- [ ] **Step 4: 验证桌面壳**

Run:

```powershell
pnpm --filter @partnest/desktop test -- App.test.tsx
pnpm --filter @partnest/desktop build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: 测试通过，Vite 构建成功，Rust 检查成功。

- [ ] **Step 5: 条件提交**

如果用户授权本地提交：

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore apps/desktop packages/domain pnpm-lock.yaml
git commit -m "chore: scaffold PartNest desktop workspace"
```

### Task 2: BOM 领域类型与库存匹配

**Files:**
- Create: `packages/domain/src/bom/types.ts`
- Create: `packages/domain/src/bom/matching.ts`
- Create: `packages/domain/src/welding/quantity.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/matching.test.ts`
- Test: `packages/domain/tests/quantity.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `@partnest/domain` package。
- Produces: `NormalizedBom`、`BomGroup`、`BomPlacement`、`InventoryPart`、`matchBomGroup()`、`defaultTakeQuantity()`。

- [ ] **Step 1: 写入匹配顺序失败测试**

```ts
expect(matchBomGroup(group({ lcscCode: "C1" }), [part({ lcscCode: "C1" })]).kind).toBe("exact-lcsc");
expect(matchBomGroup(group({ mpn: "ABC" }), [part({ mpn: "abc" })]).kind).toBe("exact-mpn");
expect(matchBomGroup(group({ value: "10k", package: "0603" }), [part({ name: "10k", package: "0603" })]).kind).toBe("candidate");
expect(matchBomGroup(group({ value: "10k", package: "0402" }), [part({ name: "10k", package: "0603" })]).kind).toBe("none");
```

Run: `pnpm --filter @partnest/domain test -- matching.test.ts`

Expected: FAIL，因为匹配器尚不存在。

- [ ] **Step 2: 定义稳定领域类型**

```ts
export type BomSide = "top" | "bottom";
export interface BomPlacement { designator: string; side: BomSide; componentKey: string; }
export interface BomGroup {
  componentKey: string; name: string; value: string; package: string;
  manufacturer: string; mpn: string; lcscCode: string;
  placements: BomPlacement[]; extraFields: Record<string, string>;
}
export interface NormalizedBom { sourceName: string; groups: BomGroup[]; }
export type MatchResult =
  | { kind: "exact-lcsc" | "exact-mpn"; partId: string }
  | { kind: "candidate"; partIds: string[] }
  | { kind: "none" };
```

- [ ] **Step 3: 实现精确匹配和候选匹配**

`lcscCode` 去除首尾空白后区分大小写；`mpn` 去除首尾空白后使用 Unicode 小写比较；候选必须同时匹配标准化名称或参数值及封装。候选不得返回单个精确结果状态。

- [ ] **Step 4: 写入并实现双面数量测试**

```ts
expect(defaultTakeQuantity(group, "top")).toBe(2);
expect(defaultTakeQuantity(group, "bottom")).toBe(1);
expect(defaultTakeQuantity(group, "all")).toEqual({ top: 2, bottom: 1 });
```

`all` 返回汇总对象，不返回可持久化板面值。

- [ ] **Step 5: 验证并条件提交**

Run: `pnpm --filter @partnest/domain test`

Expected: 全部领域测试通过。

如果用户授权：`git commit -m "feat: define BOM matching domain"`。

### Task 3: SQLite schema 与连接层

**Files:**
- Create: `apps/desktop/src-tauri/migrations/0001_initial.sql`
- Create: `apps/desktop/src-tauri/src/db/mod.rs`
- Create: `apps/desktop/src-tauri/src/db/models.rs`
- Test: `apps/desktop/src-tauri/tests/database_migration.rs`

**Interfaces:**
- Consumes: `tauri::AppHandle` 的 app data 路径。
- Produces: `Database::open(path)`、`Database::transaction()`；六张业务表。

- [ ] **Step 1: 写入迁移失败测试**

```rust
#[test]
fn migration_enforces_slot_and_quantity_constraints() {
    let db = test_database();
    assert!(insert_part(&db, "box-1", "A0", 10).is_ok());
    assert!(insert_part(&db, "box-1", "A0", 2).is_err());
    assert!(insert_part(&db, "box-1", "A1", -1).is_err());
}
```

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test database_migration`

Expected: FAIL，因为迁移和测试数据库不存在。

- [ ] **Step 2: 创建 schema**

先添加数据库依赖：

```powershell
cargo add --manifest-path apps/desktop/src-tauri/Cargo.toml rusqlite --features bundled,backup
cargo add --manifest-path apps/desktop/src-tauri/Cargo.toml uuid --features v7
cargo add --manifest-path apps/desktop/src-tauri/Cargo.toml chrono
```

`0001_initial.sql` 必须创建 `boxes`、`parts`、`bom_files`、`welding_sessions`、`welding_progress` 和 `inventory_movements`。关键约束：

```sql
UNIQUE (box_id, slot),
CHECK (quantity >= 0),
CHECK (side IN ('top', 'bottom')),
UNIQUE (session_id, component_key, side)
```

为非空 `lcsc_code` 创建 partial unique index。所有外键显式声明 `ON DELETE` 行为。

- [ ] **Step 3: 实现连接初始化**

`Database::open()` 必须执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

然后在单个 exclusive transaction 中执行未应用迁移。

- [ ] **Step 4: 验证迁移和格式**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test database_migration
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
```

Expected: 约束测试通过，格式检查通过。

- [ ] **Step 5: 条件提交**

如果用户授权：`git commit -m "feat: add PartNest SQLite schema"`。

### Task 4: 收纳盒与库存 CRUD

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/boxes.rs`
- Create: `apps/desktop/src-tauri/src/commands/parts.rs`
- Create: `apps/desktop/src/app/tauri.ts`
- Create: `apps/desktop/src/features/boxes/BoxesPage.tsx`
- Create: `apps/desktop/src/features/inventory/InventoryPage.tsx`
- Test: `apps/desktop/src-tauri/tests/inventory_commands.rs`
- Test: `apps/desktop/src/features/inventory/InventoryPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 `Database`。
- Produces: `list_boxes`、`create_box`、`resize_box`、`list_parts`、`create_part`、`update_part`、`adjust_stock` commands。

- [ ] **Step 1: 写入盒位和乐观锁失败测试**

测试必须覆盖 `A0` 正常化、超出行列范围、缩小盒子会裁掉已占用位置、重复盒位、旧 `version` 更新冲突和负库存。

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test inventory_commands`

Expected: FAIL，因为 commands 尚不存在。

- [ ] **Step 2: 实现 command DTO 和事务**

```rust
pub struct PartInput {
    pub name: String, pub category: String, pub package: String,
    pub manufacturer: String, pub mpn: String, pub lcsc_code: String,
    pub quantity: i64, pub box_id: String, pub slot: String, pub note: String,
}
```

`update_part(id, expected_version, input)` 使用 `WHERE id = ? AND version = ?`，受影响行数不是 `1` 时返回 `Conflict`。

- [ ] **Step 3: 写入界面失败测试并实现页面**

```tsx
it("keeps the occupied slot when resize would remove it", async () => {
  render(<BoxesPage api={apiRejectingResize} />);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("目标规格包含不了已占用盒位 A9")).toBeVisible();
});
```

库存页必须提供搜索、创建、编辑和数量调整；收纳盒页必须显示行列网格和占用状态。

- [ ] **Step 4: 验证 CRUD**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test inventory_commands
pnpm --filter @partnest/desktop test -- InventoryPage.test.tsx
```

Expected: 后端约束和界面错误状态测试通过。

- [ ] **Step 5: 条件提交**

如果用户授权：`git commit -m "feat: manage boxes and inventory"`。

### Task 5: CSV 与 XLSX BOM 解析

**Files:**
- Create: `apps/desktop/src-tauri/src/bom/types.rs`
- Create: `apps/desktop/src-tauri/src/bom/tabular.rs`
- Create: `fixtures/bom/comma-utf8.csv`
- Create: `fixtures/bom/tab-utf16le.csv`
- Create: `fixtures/bom/fields.xlsx`
- Test: `apps/desktop/src-tauri/tests/tabular_bom.rs`

**Interfaces:**
- Consumes: 用户提供的 CSV/XLSX 只用于本地验收，不加入 Git。
- Produces: `inspect_tabular_bom(path, mapping) -> ImportPreview`；`FieldMapping`；Rust `NormalizedBomDto`。

- [ ] **Step 1: 创建最小脱敏 fixtures**

三个 fixture 均使用表头 `Quantity,Designator,Footprint,Value,Manufacturer Part,Manufacturer,Supplier Part`，并包含 `C1,C2` 这种带逗号位号字段。逗号 CSV 必须按 CSV 规则引用 `Designator` 字段；制表符 CSV 使用 UTF-16LE BOM。

- [ ] **Step 2: 写入编码和分隔符失败测试**

```rust
#[test]
fn comma_and_tab_files_normalize_identically() {
    let comma = parse_fixture("comma-utf8.csv");
    let tab = parse_fixture("tab-utf16le.csv");
    assert_eq!(comma.groups, tab.groups);
}
```

再添加引号内逗号、字段顺序变化、未知字段、缺少可选字段和歧义字段测试。

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test tabular_bom`

Expected: FAIL，因为 parser 尚不存在。

- [ ] **Step 3: 实现探测和字段别名**

先添加解析依赖：

```powershell
cargo add --manifest-path apps/desktop/src-tauri/Cargo.toml csv calamine encoding_rs
```

先根据 BOM 检测 UTF-8、UTF-8 BOM 或 UTF-16LE BOM。对解码后的前 20 个非空记录分别尝试 `,` 和 `\t`，选择列数稳定且已识别表头最多的分隔符。必须使用 `csv` crate 处理引用字段，不能使用 `split(',')`。

内置别名至少包括：

```rust
("Quantity", "quantity"), ("Designator", "designators"),
("Footprint", "package"), ("Value", "value"), ("Comment", "name"),
("Manufacturer Part", "mpn"), ("Manufacturer", "manufacturer"),
("Supplier Part", "lcsc_code")
```

- [ ] **Step 4: 实现 XLSX 和字段映射结果**

使用 `calamine` 读取第一个非空工作表。无法唯一映射的必需字段返回：

```rust
pub enum ImportPreview {
    Ready(NormalizedBomDto),
    NeedsMapping { headers: Vec<String>, suggestions: FieldMapping },
}
```

- [ ] **Step 5: 使用真实样例做非提交验收**

Run:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test tabular_bom
pnpm dev
```

手动导入两个 `BOM_Board_V1.0_PCB2_2026-08-22` 文件。Expected: 两者均生成 52 个分组，表头映射一致；CSV 被识别为 UTF-16LE 制表符格式。

如果用户授权：`git commit -m "feat: parse CSV and XLSX BOM files"`。

### Task 6: 交互式 HTML 解析、缓存与桥接协议

**Files:**
- Create: `apps/desktop/src-tauri/src/bom/interactive_html.rs`
- Create: `apps/desktop/src-tauri/src/bom/cache.rs`
- Create: `apps/desktop/src-tauri/src/bom/bridge.rs`
- Create: `apps/desktop/src-tauri/resources/bridge-v1.js`
- Create: `fixtures/bom/interactive-minimal.html`
- Test: `apps/desktop/src-tauri/tests/interactive_bom.rs`
- Test: `apps/desktop/src-tauri/tests/bom_cache.rs`

**Interfaces:**
- Consumes: EasyEDA HTML 中 `window.files.bom_merge`、`comp_info`、`designator_info.top/bottom`。
- Produces: `cache_interactive_bom(path, display_name) -> CachedBomSession`；`resolve_bom_selection(token, designators) -> ResolvedSelection`。

- [ ] **Step 1: 写入解析与原文件不变测试**

fixture 必须包含一个器件组，顶层 `R1,R2`、底层 `R3`。测试记录原文件 SHA-256，执行缓存后再次计算原文件哈希，并断言哈希未变化、缓存副本包含 `bridge-v1` 标记。

- [ ] **Step 2: 实现结构解析和严格失败**

先添加缓存和哈希依赖：

```powershell
cargo add --manifest-path apps/desktop/src-tauri/Cargo.toml sha2 hex tempfile
```

解析器定位 `window.files = {...}` 的完整 JavaScript 对象，再解析 `bom_merge.data` 的 JSON 字符串。缺少 `comp_info` 或 `designator_info` 时返回 `UnsupportedInteractiveBom`，不得返回部分分组。

- [ ] **Step 3: 实现缓存和数据库元数据**

缓存名称使用 `<sha256>.html`。`bom_files` 保存原文件名、备注名、哈希和相对缓存名；`welding_sessions` 保存新会话或恢复 active 会话。缓存写入使用临时文件加原子重命名。

- [ ] **Step 4: 定义桥接消息和校验**

```ts
type BomSelectionMessage = {
  type: "partnest:bom-selection";
  token: string;
  designators: string[];
};
```

桥接脚本监听捕获阶段点击，并在下一帧扫描已选择 DOM 节点中的已知位号。React 只接收来自当前 iframe `contentWindow` 的消息；Rust 使用 token、会话和已解析位号表再次校验。

- [ ] **Step 5: 验证并条件提交**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test interactive_bom --test bom_cache`

Expected: 顶底层解析、哈希不变、错误格式拒绝、伪造位号拒绝均通过。

如果用户授权：`git commit -m "feat: cache and bridge interactive BOM files"`。

### Task 7: BOM 导入、字段映射和缺料分析界面

**Files:**
- Create: `apps/desktop/src/features/bom/BomImportPage.tsx`
- Create: `apps/desktop/src/features/bom/FieldMappingDialog.tsx`
- Create: `apps/desktop/src/features/bom/BomAnalysisTable.tsx`
- Create: `apps/desktop/src/features/bom/useBomImport.ts`
- Test: `apps/desktop/src/features/bom/BomImportPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 `matchBomGroup()`；Task 5/6 import commands；Task 4 inventory API。
- Produces: 仅在 React 内存存在的 `BomAnalysisRow[]`；用户确认的当前导入字段映射。

- [ ] **Step 1: 写入导入状态失败测试**

测试必须覆盖 Ready、NeedsMapping、不支持格式、精确匹配、候选匹配、未匹配和缺料数量 `max(required-stock, 0)`。

- [ ] **Step 2: 实现文件选择和字段映射**

文件选择器只展示 `.html,.csv,.xlsx`。`NeedsMapping` 时显示每个内部字段的下拉框；同一源字段不得映射到两个内部字段。映射只用于当前导入，不写入数据库。

- [ ] **Step 3: 实现分析表**

表格列为器件、封装、BOM 数量、库存、缺料、匹配状态和盒位。候选行必须提供“确认匹配”；确认前不得显示为精确匹配。

- [ ] **Step 4: 验证界面**

Run: `pnpm --filter @partnest/desktop test -- BomImportPage.test.tsx`

Expected: 所有导入与匹配状态测试通过。

- [ ] **Step 5: 条件提交**

如果用户授权：`git commit -m "feat: analyze imported BOM files"`。

### Task 8: 双面取用事务、追加和撤销

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/welding.rs`
- Create: `apps/desktop/src-tauri/src/db/welding_repository.rs`
- Test: `apps/desktop/src-tauri/tests/welding_transactions.rs`

**Interfaces:**
- Consumes: Task 3 schema；Task 6 active session；Task 4 part version。
- Produces: `confirm_take(input) -> TakeResult`、`reverse_take(movement_id) -> TakeResult`、`get_welding_progress(session_id)`。

- [ ] **Step 1: 写入事务失败测试**

测试以下输入：顶层取用 2、同组底层取用 1、顶层追加 1、库存不足、旧 version、撤销底层、重复撤销。断言顶层和底层进度互不覆盖。

- [ ] **Step 2: 定义 command 输入**

```rust
pub struct ConfirmTakeInput {
    pub session_id: String,
    pub component_key: String,
    pub side: BomSide,
    pub designators: Vec<String>,
    pub bom_quantity: i64,
    pub take_quantity: i64,
    pub part_id: String,
    pub expected_part_version: i64,
}
```

`BomSide` 只接受 `top` 或 `bottom`。

- [ ] **Step 3: 实现原子扣减**

事务顺序：验证 active session 和位号归属；读取 part；验证 version 和库存；更新数量与 version；插入负数 `consume` 流水；upsert 对应板面进度。任何失败必须回滚全部写入。

- [ ] **Step 4: 实现反向流水**

`reverse_take` 锁定原流水，拒绝已撤销流水，写入正数 `reversal`，恢复库存并从有效流水重算 `consumed_quantity` 和 `pending|partial|taken` 状态。

- [ ] **Step 5: 验证并条件提交**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test welding_transactions`

Expected: 双面、追加、库存不足、并发冲突和撤销测试全部通过。

如果用户授权：`git commit -m "feat: record atomic welding takes"`。

### Task 9: 焊接工作台与临时列宽

**Files:**
- Create: `apps/desktop/src/features/welding/WeldingPage.tsx`
- Create: `apps/desktop/src/features/welding/BomFrame.tsx`
- Create: `apps/desktop/src/features/welding/TakePanel.tsx`
- Create: `apps/desktop/src/features/welding/useBomBridge.ts`
- Create: `apps/desktop/src/features/welding/useResizableColumns.ts`
- Test: `apps/desktop/src/features/welding/WeldingPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 bridge event；Task 8 welding commands；Task 2 side quantity rules。
- Produces: 交互式 BOM 工作台；当前选择；顶层/底层独立状态；当前挂载周期内列宽状态。

- [ ] **Step 1: 写入工作流失败测试**

测试：选择不会调用 `confirm_take`；确认使用可编辑数量；顶层确认后底层仍待取用；库存不足保留输入；卸载再挂载页面后列宽回到默认值。

- [ ] **Step 2: 实现 sandbox iframe**

```tsx
<iframe
  ref={frameRef}
  src={cachedBomUrl}
  sandbox="allow-scripts"
  title="交互式 BOM"
/>
```

不得添加 `allow-same-origin`、`allow-top-navigation`、`allow-popups` 或 `allow-downloads`。

- [ ] **Step 3: 实现取用面板**

面板只显示器件、盒位、库存、位号、BOM 数量、取用数量和“确认取用（−N）”。确认成功后刷新 part version 和当前板面进度。`all` 视图显示两个板面摘要，不直接提交 `all`。

- [ ] **Step 4: 实现可拖动列宽**

`useResizableColumns(defaults)` 只使用 `useState`。禁止调用 localStorage、Tauri storage 或数据库 command。拖动范围限制为每列 `72–480 px`；组件卸载后状态自然销毁。

- [ ] **Step 5: 验证工作台并条件提交**

Run: `pnpm --filter @partnest/desktop test -- WeldingPage.test.tsx`

Expected: 选择、确认、双面、库存不足和列宽重置测试通过。

如果用户授权：`git commit -m "feat: add welding workspace"`。

### Task 10: 流水、备份与 Windows 验收

**Files:**
- Create: `apps/desktop/src-tauri/src/backup.rs`
- Create: `apps/desktop/src-tauri/src/commands/movements.rs`
- Create: `apps/desktop/src-tauri/src/commands/settings.rs`
- Create: `apps/desktop/src/features/movements/MovementsPage.tsx`
- Create: `apps/desktop/src/features/settings/SettingsPage.tsx`
- Create: `scripts/verify.ps1`
- Test: `apps/desktop/src-tauri/tests/backup_restore.rs`
- Test: `apps/desktop/src/features/movements/MovementsPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 database；Task 8 movements。
- Produces: `list_movements`、`create_backup`、`restore_backup`；统一软件验收脚本。

- [ ] **Step 1: 写入备份失败测试**

测试在 WAL 模式和未 checkpoint 的写入后调用备份，打开备份文件并核对 box、part、movement 和 welding progress 数量。损坏或 schema 版本高于当前应用的备份必须被拒绝。

- [ ] **Step 2: 实现一致性备份**

使用 rusqlite backup API 写入临时文件，执行 `PRAGMA integrity_check` 后原子重命名。应用启动时，如果最近成功备份早于 24 小时则创建备份；保留最近 10 个有效备份。设置页提供手动备份和选择备份恢复。

- [ ] **Step 3: 实现流水页面**

页面按时间倒序显示器件、变化量、变化前、变化后、原因和 BOM 备注名。只有未撤销的 `consume` 流水显示“撤销取用”。

- [ ] **Step 4: 创建统一验证脚本**

`scripts/verify.ps1` 必须依次执行：

```powershell
pnpm test
pnpm build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
pnpm --filter @partnest/desktop tauri build
git diff --check
```

任何命令失败时脚本必须立即退出非零状态。

- [ ] **Step 5: 执行 Windows 10/11 验收**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`

然后在 Windows 10 和 Windows 11 各执行一次基础流程：创建盒子和器件，导入 CSV 和 XLSX，并打开缓存 HTML。

继续执行焊接流程：分别确认顶层和底层取用，执行追加和撤销，重启应用恢复进度，然后从备份恢复数据库。

Expected: 自动验证全部通过；两个 Windows 版本的人工流程均无数据丢失，原始 BOM 哈希不变。

- [ ] **Step 6: 条件提交**

如果用户授权：

```powershell
git add apps/desktop scripts pnpm-lock.yaml
git commit -m "feat: complete PartNest MVP"
```

不得添加用户提供的 BOM 原文件，不得推送。
