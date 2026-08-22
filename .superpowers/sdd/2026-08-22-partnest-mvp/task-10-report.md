# Task 10 报告：流水、备份与 Windows 验收

## Status

Implemented. Product changes are ready for the requested local commit. No command is hung or waiting for interaction.

## Commit(s)

Local commit: `feat: complete PartNest MVP` (see `git log -1` for the final hash).

## Files changed

- Added SQLite online-backup/validation/rotation/restore support in `apps/desktop/src-tauri/src/backup.rs`.
- Added movement listing and settings backup/restore Tauri commands, command registration, startup auto-backup, and dialog plugin capability.
- Added `MovementsPage`, `SettingsPage`, frontend API bindings, route mounting, and focused movement UI test.
- Added backup/restore and movement repository integration tests.
- Added `scripts/verify.ps1` with repository-root resolution and fail-fast execution.
- Resolved the `tests/tabular_bom.rs` import ordering required by `cargo fmt --check`.
- Added `tauri-plugin-dialog` dependency and lockfile entries so file selection works in the desktop runtime.

The tracked deletion `需求.md`, untracked `docs/需求.md`, root BOM samples, and pre-existing untracked generated schemas were not staged or modified.

## RED/GREEN evidence

### Backup/restore

RED:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test backup_restore
```

Result: failed to compile because `partnest_desktop_lib::backup` did not exist.

GREEN:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test backup_restore
```

Result: 5 passed, 0 failed. Covered uncheckpointed WAL rows, integrity/schema rejection, ten-backup rotation, valid restore, and failed-restore preservation.

### Movement UI

RED:

```powershell
pnpm --filter @partnest/desktop test -- MovementsPage.test.tsx
```

Result: failed because `MovementsPage.tsx` did not exist.

GREEN:

```powershell
pnpm --filter @partnest/desktop test -- MovementsPage.test.tsx
```

Result: 1 test passed, 0 failed.

## Full verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

Result: exit 0. The script executed, in order:

1. `pnpm test`: domain 7 tests and desktop 24 tests passed.
2. `pnpm build`: domain TypeScript build and desktop Vite build passed.
3. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: all 59 Rust unit/integration tests passed, with 0 failures (doc-tests had 0 tests).
4. `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`: passed.
5. `pnpm --filter @partnest/desktop tauri build`: release application built at `apps/desktop/src-tauri/target/release/partnest-desktop.exe`.
6. `git diff --check`: passed.

Additional check:

```powershell
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

Result: passed.

The first online Cargo retry for the new dialog dependency was blocked by the host credential/network error `SEC_E_NO_CREDENTIALS`; the locally cached dependency was then resolved and verified with Cargo offline. Subsequent normal Cargo commands completed successfully.

## Windows acceptance

| Platform/evidence | Status | Evidence |
| --- | --- | --- |
| Windows 10 software gates | PASS | Current host identified as Windows 10 Pro 22H2, build 19045; unified verification passed. |
| Windows 10 manual workflow | UNVERIFIED | No interactive manual run was performed: box/part creation, CSV/XLSX import, cached HTML, top/bottom welding, append/reversal, restart, and restore were not claimed. |
| Windows 11 software gates | UNVERIFIED | No Windows 11 host/environment available. |
| Windows 11 manual workflow | UNVERIFIED | No Windows 11 environment available. |
| Original BOM hash preservation | UNVERIFIED | Automated tests used only temporary databases and repository fixtures; user BOM samples were not imported or hashed. |

## Self-review

- Backup uses rusqlite SQLite Backup API, so WAL-only writes are included; it writes to a temp file, validates integrity/schema, then renames atomically.
- Temp files are owned by `TempPath` and clean up on error; existing valid backups are not pre-deleted. Rotation validates only managed `partnest-*.db` files and leaves invalid/unrelated files untouched.
- Restore validates the explicitly selected source first, rejects newer schema versions and the live database path, copies to a validated temp database, closes the live connection, swaps files, reopens migrations, and rolls back the previous file on replacement failure.
- Movement rows are newest-first and derive before/after quantities from the current SQLite source of truth. Only unreversed negative `consume` rows expose reversal, and the page reloads after successful reversal.
- Settings backup/restore actions require an explicit file selection; the dialog plugin is initialized and capability-enabled. No path is constructed from an unchecked filename.
- The verify script resolves the repository root from `$PSScriptRoot`, stops on the first nonzero native exit code, and preserves the exact required command order.

## Concerns

- Manual Windows 10/11 acceptance remains an external gate and must be performed on the target OSes before release claims.
- The current-host Cargo toolchain emits a non-failing linker stdout warning; it does not affect the successful build/test gates.
