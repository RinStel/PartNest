[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "msvc-env.ps1")
$previousTargetDir = $env:CARGO_TARGET_DIR

Push-Location $repoRoot
try {
    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) { throw "此脚本仅支持 Windows x64。" }
    foreach ($tool in @("pnpm", "cargo", "rustc")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "未找到 $tool。请先安装 README 声明的工具。" }
    }
    $rustInfo = & rustc -vV
    if ($LASTEXITCODE -ne 0 -or $rustInfo -notcontains "host: x86_64-pc-windows-msvc") {
        throw "需要 x86_64-pc-windows-msvc Rust 工具链。"
    }
    if ($env:CARGO_BUILD_TARGET -and $env:CARGO_BUILD_TARGET -ne "x86_64-pc-windows-msvc") {
        throw "CARGO_BUILD_TARGET 与 Windows x64 发布目标不一致，请先清除此变量。"
    }
    $tauri = Get-Content -LiteralPath "apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
    $desktop = Get-Content -LiteralPath "apps/desktop/package.json" -Raw | ConvertFrom-Json
    $cargo = Get-Content -LiteralPath "apps/desktop/src-tauri/Cargo.toml" -Raw
    $packageSection = [regex]::Match($cargo, '(?ms)^\[package\]\s*(.*?)(?=^\[|\z)').Groups[1].Value
    $cargoVersion = [regex]::Match($packageSection, '(?m)^version\s*=\s*"([^"\r\n]+)"').Groups[1].Value
    $version = $tauri.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or $version -ne $desktop.version -or $version -ne $cargoVersion) {
        throw "版本不一致：tauri=$version，desktop=$($desktop.version)，cargo=$cargoVersion。"
    }
    $vsDevCmdPath = Get-PnVsDevCmdPath
    if (-not $vsDevCmdPath -and -not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        throw "未找到 MSVC C++ 工具链。请安装 Visual Studio Build Tools 的 C++ 桌面开发组件。"
    }
    $env:CARGO_TARGET_DIR = Join-Path $repoRoot "apps/desktop/src-tauri/target"
    Invoke-PnCommand "pnpm install --frozen-lockfile"
    # 验证脚本包括前后端测试、类型检查、Clippy、格式检查与 release 构建。
    & (Join-Path $PSScriptRoot "verify.ps1")
    if (-not $?) { throw "发布验证失败。" }

    $targetSubdir = if ($env:CARGO_BUILD_TARGET) { "x86_64-pc-windows-msvc/release" } else { "release" }
    $binary = Join-Path $env:CARGO_TARGET_DIR "$targetSubdir/partnest-desktop.exe"
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "构建没有生成 EXE：$binary" }
    $bytes = [System.IO.File]::ReadAllBytes($binary)
    if ($bytes.Length -lt 64) { throw "生成的 EXE 无效。" }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length -or [BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550 -or [BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x8664) {
        throw "生成的 EXE 不是 Windows x64 PE 文件。"
    }
    $outputDirectory = Join-Path $repoRoot "dist/releases/v$version"
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $artifact = Join-Path $outputDirectory "PartNest-$version-windows-x64.exe"
    Copy-Item -LiteralPath $binary -Destination $artifact -Force
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
    Write-Host "Release 产物：$artifact"
    Write-Host "SHA256：$hash"
}
catch {
    Write-Error $_
    exit 1
}
finally {
    $env:CARGO_TARGET_DIR = $previousTargetDir
    Pop-Location
}
