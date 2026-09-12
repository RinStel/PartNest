# PartNest

面向个人电子 DIY 的元器件库存与 BOM 缺料分析工具：Tauri 2 + React + TypeScript + SQLite，
交互式 BOM 在沙箱 iframe 中渲染，只通过带会话令牌的消息上报选择。

## 环境要求

- Node.js 与 pnpm 10（根 `package.json` 的 `packageManager` 已锁定）
- Rust stable 的 MSVC 工具链，以及 Visual Studio 2022「使用 C++ 的桌面开发」工作负载
- Windows 上无需手工配置编译器环境变量，脚本会自动定位并加载 `VsDevCmd.bat`

## 安装与开发

```powershell
pnpm install
pnpm dev            # 等价于 pnpm --filter @partnest/desktop tauri dev
```

## 验证

```powershell
.\scripts\verify.ps1
```

依次执行 `pnpm test`、`pnpm build`、`cargo test`、`cargo clippy --all-targets -- -D warnings`、
`cargo fmt --check`、`tsc --noEmit`、`pnpm --filter @partnest/desktop tauri build` 和 `git diff --check`。
其中 `tauri build` 会调用系统打包工具，首次执行可能需要联网下载。

Rust 相关命令在 `call VsDevCmd.bat -arch=x64 && set CC= && set CXX=` 的子进程中运行。全局设置了带空格的
`CC`（例如 `C:\Program Files\...\cl.exe`）时，`libsqlite3-sys` 的构建脚本会以
`failed to find tool "C:\Program"` 失败，因此这一步不可省略；环境引导逻辑与发布脚本共用
`scripts\msvc-env.ps1`。

## 构建

### 命令

```powershell
.\scripts\build_release.ps1
```

脚本会加载本机 Visual Studio 的 x64 C++ 构建环境，并仅在当前构建进程中清除 `CC`、`CXX` 等编译器覆盖变量。

### 文件路径

`apps\desktop\src-tauri\target\release\partnest-desktop.exe`

## 数据库迁移

新增迁移需要同时完成三处，否则迁移一致性测试和备份校验测试会失败：

1. 在 `apps\desktop\src-tauri\migrations\` 增加 `00XX_name.sql`，版本号必须连续。
2. 把该文件登记到 `src\db\mod.rs` 的 `migrations()` 清单（唯一清单，启动与测试共用）。
3. 同步 `src\backup.rs` 的 `CURRENT_SCHEMA_VERSION`；新增表或索引时补充 `require_table`/`require_index`。

## 交互式 BOM 约定

- 「BOM 分析」页选择文件只做只读分析，点击「设为活动 BOM」才会写入缓存副本并切换焊接工作台的会话。
- 焊接工作台只接受操作者在 BOM 文档内真实交互后上报的选择；宿主侧还会校验令牌、位号归属、数量上限与消息频率。
- 同一会话同一板面的位号只扣减一次库存，全部已取用时重复提交会被拒绝；撤销取用流水会释放对应位号。
- 缓存副本缺失或损坏时，界面提示会引导回到「BOM 分析」页重新选择文件，而不是要求重装数据。
