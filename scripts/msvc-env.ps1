# MSVC 构建环境引导，供 scripts/verify.ps1 与 scripts/build_release.ps1 共用。
#
# Windows 上 cc-rs 会直接使用 CC/CXX 环境变量。全局设置了带空格的 CC（例如
# "C:\Program Files\...\cl.exe"）时，libsqlite3-sys 的构建脚本会以
# failed to find tool "C:\Program" 失败。解决办法是加载 VsDevCmd 的 x64 C++
# 环境，并且只在构建子进程内清除这些覆盖变量。

$script:PnCompilerEnvironmentVariables = @(
    "CC",
    "CXX",
    "AR",
    "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER",
    "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_AR"
)

function Get-PnVsDevCmdPath {
    $vswherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $vswherePath)) {
        return $null
    }

    $installationPath = & $vswherePath `
        -latest `
        -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($installationPath)) {
        return $null
    }

    $vsDevCmdPath = Join-Path $installationPath.Trim() "Common7\Tools\VsDevCmd.bat"
    if (Test-Path -LiteralPath $vsDevCmdPath) {
        return $vsDevCmdPath
    }

    return $null
}

function Clear-PnCompilerEnvironment {
    foreach ($name in $script:PnCompilerEnvironmentVariables) {
        if (Test-Path "Env:$name") {
            Write-Host "清除当前进程的 $name"
            Remove-Item "Env:$name"
        }
    }
}

function Get-PnClearCommands {
    ($script:PnCompilerEnvironmentVariables | ForEach-Object { "set `"$_=`"" }) -join " && "
}

<#
.SYNOPSIS
    在 MSVC 环境里执行一条命令行，失败时抛出异常。
.DESCRIPTION
    提供 $VsDevCmdPath 时，命令在 "call VsDevCmd.bat && 清除编译器覆盖 && 命令"
    的 cmd 子进程里执行；否则退回当前进程并清除覆盖变量。
    返回值无意义，失败通过 throw 表达，退出码保留在 $LASTEXITCODE。
    注意：退出码取自管道的最后一个进程，所以不要把 "cargo test | findstr ..."
    这类命令直接传进来——没匹配到内容时 findstr 会以退出码 1 结束，
    看起来就像构建失败。需要过滤输出时请先重定向到文件，或者给命令加 --quiet。
#>
function Invoke-PnCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $false)][string]$VsDevCmdPath,
        [Parameter(Mandatory = $false)][string]$FailureMessage
    )

    Write-Host ("> {0}" -f $CommandLine)
    if ($VsDevCmdPath) {
        & $env:ComSpec /d /s /c "call `"$VsDevCmdPath`" -arch=x64 -host_arch=x64 >nul && $(Get-PnClearCommands) && $CommandLine"
    }
    else {
        Clear-PnCompilerEnvironment
        & $env:ComSpec /d /s /c $CommandLine
    }

    if ($LASTEXITCODE -ne 0) {
        $detail = if ($FailureMessage) { $FailureMessage } else { "命令执行失败" }
        throw "{0}（退出码 $LASTEXITCODE）：$CommandLine" -f $detail
    }
}
