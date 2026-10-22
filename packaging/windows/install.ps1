# Installs mctwain for the current user and starts it at login. (The zip alternative to the installer .exe.)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'mctwain'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Stop a previous version if one is running.
Get-Process -Name mctwain, mctwain-tray -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

foreach ($file in 'mctwain.exe', 'mctwain-tray.exe', 'start.vbs') {
  $source = Join-Path $PSScriptRoot $file
  if (Test-Path $source) { Copy-Item $source (Join-Path $dir $file) -Force }
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# A fresh profile may not have the Run key yet (never force-create it: that could wipe other startup entries).
if (-not (Test-Path $runKey)) { New-Item -Path $runKey | Out-Null }
Set-ItemProperty -Path $runKey -Name 'mctwain' `
  -Value "wscript.exe `"$dir\start.vbs`""
Start-Process wscript.exe -ArgumentList "`"$dir\start.vbs`""

Write-Host ''
Write-Host 'mctwain is installed and running. It starts automatically at login.'
Write-Host 'You can go back to the web page now.'
