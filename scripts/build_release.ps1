[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "msvc-env.ps1")

function Invoke-ReleaseBuild {
    param([string]$VsDevCmdPath)

    Invoke-PnCommand "pnpm --filter @partnest/desktop tauri build" -VsDevCmdPath $VsDevCmdPath
}

Push-Location $repoRoot
try {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "未找到 pnpm。请先安装项目声明的 pnpm 版本。"
    }

    $vsDevCmdPath = Get-PnVsDevCmdPath
    if (-not $vsDevCmdPath -and -not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
        throw @"
未找到 MSVC C++ 工具链。请安装 Visual Studio 2022 Build Tools，并选择：
- Desktop development with C++
- MSVC v143 C++ x64/x86 build tools
- Windows 10 或 Windows 11 SDK
安装后重新运行此脚本。
"@
    }

    Invoke-ReleaseBuild -VsDevCmdPath $vsDevCmdPath
    Write-Host "Release 构建完成：apps\desktop\src-tauri\target\release\partnest-desktop.exe"
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Pop-Location
}
