[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-VerificationCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    Write-Host ("> {0} {1}" -f $Command, ($Arguments -join " "))
    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "验证命令失败（退出码 $exitCode）：$Command $($Arguments -join ' ')"
    }
}
Push-Location $repoRoot
try {
    Invoke-VerificationCommand "pnpm" @("test")
    Invoke-VerificationCommand "pnpm" @("build")
    Invoke-VerificationCommand "cargo" @("test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml")
    Invoke-VerificationCommand "cargo" @("fmt", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--check")
    Invoke-VerificationCommand "pnpm" @("--filter", "@partnest/desktop", "tauri", "build")
    Invoke-VerificationCommand "git" @("diff", "--check")
}
catch {
    Write-Error $_
    exit 1
}
finally {
    Pop-Location
}
