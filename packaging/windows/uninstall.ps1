# Removes mctwain for the current user.
Get-Process -Name mctwain -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'mctwain' -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'mctwain') -ErrorAction SilentlyContinue
Write-Host 'mctwain was removed.'
