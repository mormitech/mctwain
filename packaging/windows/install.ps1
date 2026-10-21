# Installs mctwain for the current user and starts it at login.
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'mctwain'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Stop a previous version if one is running.
Get-Process -Name mctwain -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Copy-Item (Join-Path $PSScriptRoot 'mctwain.exe') (Join-Path $dir 'mctwain.exe') -Force

# A tiny launcher so mctwain runs without a console window.
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.Environment("Process")("MCTWAIN_ALLOWED_ORIGINS") = "__ALLOWED_ORIGINS__"
sh.Run """$dir\mctwain.exe""", 0, False
"@
Set-Content -Path (Join-Path $dir 'start.vbs') -Value $vbs -Encoding ASCII

Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'mctwain' `
  -Value "wscript.exe `"$dir\start.vbs`""
Start-Process wscript.exe -ArgumentList "`"$dir\start.vbs`""

Write-Host ''
Write-Host 'mctwain is installed and running. It starts automatically at login.'
Write-Host 'You can go back to the web page now.'
