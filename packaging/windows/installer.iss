; Inno Setup script for mctwain. Per-user install (no admin rights), starts at login, starts right away.
; Silent install, as winget runs it:  mctwain-setup-<version>-windows-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
[Setup]
AppId={{B5C1F3E4-8E2A-4C57-9D1B-6F7A2D3C9E10}
AppName=mctwain
AppVersion=__VERSION__
AppPublisher=mormitech
AppPublisherURL=https://github.com/mormitech/mctwain
AppSupportURL=https://github.com/mormitech/mctwain/issues
DefaultDirName={localappdata}\mctwain
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=mctwain-setup-__VERSION__-windows-x64
UninstallDisplayName=mctwain
Compression=lzma2
SolidCompression=yes

[Files]
Source: "mctwain.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "mctwain-tray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "start.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "mctwain"; ValueData: "wscript.exe ""{app}\start.vbs"""; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start.vbs"""; Flags: nowait runhidden

[Code]
// taskkill returns before Windows has released the files of the killed process, so wait a moment before the
// installer replaces or deletes them.
procedure StopMctwain;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM mctwain-tray.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM mctwain.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(2000);
end;

// An upgrade replaces files that are in use, so stop the running helper and tray first.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then StopMctwain;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopMctwain;
end;
