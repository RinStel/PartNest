[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "msvc-env.ps1")

Push-Location $repoRoot
try {
    # Rust 构建需要 MSVC C++ 环境，并且必须清除带空格的 CC/CXX 覆盖，
    # 否则 cc-rs 找不到编译器，整条验证链在开发机上跑不通。
    $vsDevCmdPath = Get-PnVsDevCmdPath
    if ($vsDevCmdPath) {
        Write-Host "已加载 Visual Studio x64 C++ 构建环境。"
    }

    Invoke-PnCommand "pnpm test"
    Invoke-PnCommand "pnpm build"
    Invoke-PnCommand "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml" -VsDevCmdPath $vsDevCmdPath
    Invoke-PnCommand "cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --offline -- -D warnings" -VsDevCmdPath $vsDevCmdPath
    Invoke-PnCommand "cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check"
    Invoke-PnCommand ".\node_modules\.bin\tsc.CMD -p apps/desktop/tsconfig.json --noEmit"
    Invoke-PnCommand "pnpm --filter @partnest/desktop tauri build" -VsDevCmdPath $vsDevCmdPath
    Invoke-PnCommand "git diff --check"
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Pop-Location
}
