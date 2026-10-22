' Starts mctwain and its tray icon, hidden. Registered to run at login (HKCU\...\Run) by the installers.
Set sh = CreateObject("WScript.Shell")
dir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\mctwain")
sh.Environment("Process")("MCTWAIN_ALLOWED_ORIGINS") = "__ALLOWED_ORIGINS__"
sh.Run """" & dir & "\mctwain.exe""", 0, False
sh.Run """" & dir & "\mctwain-tray.exe""", 0, False
