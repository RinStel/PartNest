# Task 3 report

Status: DONE

Commit: `6ef09da feat: redesign inventory and box workspace`

Implemented:

- Added reusable `DataTable` and `FormField` primitives.
- Reworked inventory into a compact fixed-column table with complete metadata columns, inline audited stock adjustment, and `PartDrawer` metadata editing.
- Added dirty-form discard confirmation for the part drawer.
- Reworked boxes into a left list/right slot workspace; occupied slots are mapped from `listParts()` and show part name and quantity.
- Added `BoxDialog` for create/edit, dirty-form discard confirmation, deletion confirmation, and retained backend occupancy errors.
- Added compact inventory/box styling and updated feature tests.
- Kept page-local toolbar fallback for isolated feature tests; in the AppShell, actions register with the single shell toolbar. `usePageActions` now safely no-ops outside a router/shell test harness.

Verification:

- `pnpm --filter @partnest/desktop test` — 10 files, 53 tests passed.
- `./node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit` — passed.
- `pnpm --filter @partnest/desktop build` — passed.
- `git diff --check` — passed.

## Fix round 2

Commit: pending

- Reworked layout contract coverage to avoid jsdom `clientWidth` measurements.
- Coverage now checks stable overflow-owner/table/grid classes, table column structure, and the box grid column CSS variable. Actual 1280×800 rendering remains a Tauri-window validation gate.

Verification:

- `pnpm --filter @partnest/desktop test -- src/features/inventory/inventory-layout-contract.test.tsx` — passed.
- `pnpm --filter @partnest/desktop test` — 11 files, 56 tests passed.
- `./node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit` — passed.
- `pnpm --filter @partnest/desktop build` — passed.

## Fix round 2

Commit: pending

- Reworked the layout contract coverage to avoid jsdom `clientWidth` measurements.
- The test now checks stable overflow-owner/table/grid classes, the box grid column CSS variable, and the table column structure. Actual 1280×800 rendering remains a Tauri-window validation gate.

Verification:

- `pnpm --filter @partnest/desktop test -- src/features/inventory/inventory-layout-contract.test.tsx` — passed.
- `pnpm --filter @partnest/desktop test` — 11 files, 56 tests passed.
- `./node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit` — passed.
- `pnpm --filter @partnest/desktop build` — passed.

Notes:

- The user-owned `需求.md` move and `docs/需求.md` remain untouched and uncommitted.

## Fix round 1

Commit: `f108850 fix: harden inventory and box overlays`

- Overlay forms now route their cancel buttons through the overlay dirty/confirm path.
- Repeated `新增器件`/`新增收纳盒` requests first ask to discard the current dirty draft; a rejected confirmation preserves it.
- Box slots visibly render `已占用` or `空闲` in addition to accessible labels.
- Added dirty-confirm coverage and a 1280×800 layout/overflow contract test.

Verification:

- `pnpm --filter @partnest/desktop test` — 11 files, 56 tests passed.
- `./node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit` — passed.
- `pnpm --filter @partnest/desktop build` — passed.
- `git diff --check` — passed.
