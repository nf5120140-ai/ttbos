// ============================================================
// תתבוס — יצירת קבצי ההתקנה של "קופה נעולה" ל-Windows (ZIP) מתוך האפליקציה
// ============================================================

const crlf = (s) => s.replace(/\r?\n/g, '\r\n')

function launcherBat(url) {
  return crlf(`@echo off
REM ============================================================
REM  Tatbus kiosk launcher (runs hidden in the background).
REM  Opens ONLY the register, full screen. If someone closes it
REM  it reopens automatically and the manager gets an alert.
REM  Manager exit: Ctrl+Shift+Q inside the register + manager PIN.
REM ============================================================
set "URL=${url}&reg=%COMPUTERNAME%"
set "DURL=${url.replace('?kiosk=1', '?display=1')}&reg=%COMPUTERNAME%"
set PROFILE=%LOCALAPPDATA%\\TatbusKiosk
set FLAGDIR=%USERPROFILE%\\Downloads

set CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" set CHROME=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" exit /b 1
if /i "%~1"=="display" goto display

REM already running? (prevents a second copy)
powershell -NoProfile -WindowStyle Hidden -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*TatbusKiosk*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 exit /b 0

del /q "%FLAGDIR%\\tatbus-exit*.flag" 2>nul
REM customer screen on the second monitor (if there is one)
start "" /b cmd /c ""%~f0" display"
timeout /t 3 /nobreak >nul

:loop
start "" /wait "%CHROME%" --kiosk "%URL%" --user-data-dir="%PROFILE%" --no-first-run --disable-session-crashed-bubble --disable-features=Translate --overscroll-history-navigation=0 --disable-pinch
REM Chrome sometimes hands the window to another chrome process and returns at once.
REM Wait while the register window is still open - do NOT open another copy.
:waitgone
timeout /t 1 /nobreak >nul
if exist "%FLAGDIR%\\tatbus-exit*.flag" goto managerexit
powershell -NoProfile -WindowStyle Hidden -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*TatbusKiosk*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 goto waitgone
goto loop

:managerexit
del /q "%FLAGDIR%\\tatbus-exit*.flag" 2>nul
REM close the customer screen too
powershell -NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*tatbus-kiosk.bat*display*') -or ($_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*TatbusDisplay*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
REM full lock (register is the whole screen, no desktop): manager exit = sign out
if /i "%~1"=="shell" shutdown /l
exit /b 0

REM ---------------- customer screen (second monitor) ----------------
:display
set DX=
set DY=
for /f "usebackq tokens=1,2" %%a in (\`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1; if ($s) { '' + $s.Bounds.X + ' ' + $s.Bounds.Y }"\`) do (
  set DX=%%a
  set DY=%%b
)
if not defined DX exit /b 0
:dloop
start "" /wait "%CHROME%" --kiosk "%DURL%" --user-data-dir="%LOCALAPPDATA%\\TatbusDisplay" --window-position=%DX%,%DY% --no-first-run --disable-session-crashed-bubble --disable-features=Translate --disable-pinch
:dwait
timeout /t 3 /nobreak >nul
powershell -NoProfile -WindowStyle Hidden -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*TatbusDisplay*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 goto dwait
goto dloop
`)
}

// במצב נעילה מלאה זה ה"מעטפת" של משתמש הקופה במקום שולחן העבודה של Windows
const shellVbs = crlf(`' Tatbus - full lock: the register IS the screen (no desktop, no taskbar)
Set sh = CreateObject("WScript.Shell")
p = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\TatbusKiosk-run\\tatbus-kiosk.bat"
sh.Run "cmd /c """ & p & """ shell", 0, True
`)

const hiddenVbs = crlf(`' Tatbus - start the register hidden (no black window)
Set sh = CreateObject("WScript.Shell")
p = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\TatbusKiosk-run\\tatbus-kiosk.bat"
sh.Run "cmd /c """ & p & """", 0, False
`)

const installBat = crlf(`@echo off
REM ============================================================
REM  Run ONCE while signed in as the kiosk Windows user (e.g. "Kupa").
REM  - The register opens automatically (hidden launcher) at every login
REM  - "Tatbus" icon on the desktop to reopen it after a manager exit
REM ============================================================
REM warn if this is an admin user (the register should run in its own standard user)
set ADMIN=0
powershell -NoProfile -Command "if ((whoami /groups) -match 'S-1-5-32-544') { exit 1 } else { exit 0 }"
if errorlevel 1 set ADMIN=1
if "%ADMIN%"=="0" goto doinstall
echo.
echo  WARNING: you are signed in as an ADMIN user.
echo  The register will open full screen at EVERY login of this user.
echo  Better: install it in a separate standard user (e.g. Kupa).
echo.
set OK=
set /p OK=Install here anyway? Type YES: 
if /i not "%OK%"=="YES" (
  echo Cancelled. Nothing was installed.
  pause
  exit /b 1
)
:doinstall
set RUN=%LOCALAPPDATA%\\TatbusKiosk-run
set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
if not exist "%RUN%" mkdir "%RUN%"
copy /Y "%~dp0tatbus-kiosk.bat" "%RUN%\\tatbus-kiosk.bat" >nul || goto fail
copy /Y "%~dp0tatbus-start.vbs" "%RUN%\\tatbus-start.vbs" >nul || goto fail
copy /Y "%~dp0tatbus-shell.vbs" "%RUN%\\tatbus-shell.vbs" >nul || goto fail
REM remove old (visible) launcher from older versions
del "%STARTUP%\\tatbus-kiosk.bat" 2>nul
del "%USERPROFILE%\\Desktop\\Tatbus.bat" 2>nul
copy /Y "%~dp0tatbus-start.vbs" "%STARTUP%\\tatbus-start.vbs" >nul || goto fail
copy /Y "%~dp0tatbus-start.vbs" "%USERPROFILE%\\Desktop\\Tatbus.vbs" >nul
echo.
echo  Done. The register will open automatically at every login of this user.
echo  Manager exit: Ctrl+Shift+Q inside the register, then manager PIN.
echo  To reopen after exit: double-click "Tatbus" on the desktop.
echo.
echo  Starting the register now...
wscript "%RUN%\\tatbus-start.vbs"
timeout /t 5 >nul
exit /b 0
:fail
echo Copy failed. Extract ALL files from the zip into one folder and run again.
pause
exit /b 1
`)

const uninstallBat = crlf(`@echo off
REM Removes the kiosk register from this Windows user.
REM 1) stop the hidden launcher and the register window
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*TatbusKiosk-run*') -or ($_.Name -eq 'chrome.exe' -and ($_.CommandLine -like '*TatbusKiosk*' -or $_.CommandLine -like '*TatbusDisplay*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
del "%STARTUP%\\tatbus-start.vbs" 2>nul
del "%STARTUP%\\tatbus-kiosk.bat" 2>nul
del "%USERPROFILE%\\Desktop\\Tatbus.vbs" 2>nul
del "%USERPROFILE%\\Desktop\\Tatbus.bat" 2>nul
rmdir /s /q "%LOCALAPPDATA%\\TatbusKiosk-run" 2>nul
echo Removed. The register is closed and will not open again for this user.
echo (The register data in %LOCALAPPDATA%\\TatbusKiosk was kept.)
pause
`)

// ---- נעילת Windows למשתמש הקופה ----
// משתמש רגיל לא יכול לכתוב הגדרות מדיניות, לכן הקובץ מבקש הרשאת מנהל (UAC)
// וכותב את ההגדרות ישירות לפרופיל של משתמש הקופה (לא של המנהל).
const lockPs1 = (appHost) => crlf(String.raw`param([switch]$Unlock)
$ErrorActionPreference = 'Continue'

function Test-Admin($sid) {
  try {
    foreach ($m in (Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop)) { if ($m.SID.Value -eq $sid) { return $true } }
    return $false
  } catch {
    try {
      $g = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate([System.Security.Principal.NTAccount]).Value.Split('\')[-1]
      foreach ($m in ([ADSI]"WinNT://$env:COMPUTERNAME/$g,group").psbase.Invoke('Members')) {
        $bytes = $m.GetType().InvokeMember('objectSid', 'GetProperty', $null, $m, $null)
        if ((New-Object System.Security.Principal.SecurityIdentifier($bytes, 0)).Value -eq $sid) { return $true }
      }
      return $false
    } catch { return $true }  # if we can't tell - treat as admin (safe side)
  }
}

$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$list = @()
foreach ($p in (Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special -and $_.SID -like 'S-1-5-21-*' })) {
  try { $n = (New-Object System.Security.Principal.SecurityIdentifier($p.SID)).Translate([System.Security.Principal.NTAccount]).Value } catch { $n = $p.LocalPath }
  $adm = (Test-Admin $p.SID) -or ($p.SID -eq $me)
  $list += [pscustomobject]@{ Name = $n; Sid = $p.SID; Path = $p.LocalPath; Admin = $adm }
}

Write-Host ''
Write-Host 'Users on this computer:'
for ($i = 0; $i -lt $list.Count; $i++) {
  $tag = ''; if ($list[$i].Admin -and -not $Unlock) { $tag = '   (ADMIN - will NOT be locked)' }
  Write-Host ("  " + ($i + 1) + ") " + $list[$i].Name + $tag)
}
if ($Unlock) { Write-Host '  0) ALL users' }

$c = Read-Host ('Type the number of the REGISTER user to ' + $(if ($Unlock) { 'UNLOCK' } else { 'LOCK' }) + ' and press Enter')
if ($Unlock -and $c -eq '0') { $sel = $list }
else {
  $k = 0
  if (-not [int]::TryParse($c, [ref]$k) -or $k -lt 1 -or $k -gt $list.Count) { Write-Host 'Wrong number. Nothing was changed.' -ForegroundColor Red; exit 1 }
  $sel = @($list[$k - 1])
}

if (-not $Unlock) {
  $u = $sel[0]
  if ($u.Admin) {
    Write-Host ''
    Write-Host ("'" + $u.Name + "' is an ADMIN user. It will NOT be locked.") -ForegroundColor Red
    Write-Host 'Create a separate STANDARD user for the register, sign in to it once, and run this again.'
    exit 1
  }
  $shellFile = Join-Path $u.Path 'AppData\Local\TatbusKiosk-run\tatbus-shell.vbs'
  if (-not (Test-Path $shellFile)) {
    Write-Host ''
    Write-Host ("The register is not installed in '" + $u.Name + "'.") -ForegroundColor Red
    Write-Host 'Sign in as that user, run install-kiosk.bat (new version), then run this again.'
    exit 1
  }
  $ok = Read-Host ("Lock '" + $u.Name + "'? Type YES")
  if ($ok -ne 'YES') { Write-Host 'Cancelled. Nothing was changed.'; exit 1 }
}

$expVals = 'NoWinKeys','NoRun','NoControlPanel','NoViewContextMenu','NoTrayContextMenu','NoFind','NoStartMenuMorePrograms','RestrictRun'
$sysVals = 'DisableTaskMgr','DisableRegistryTools','DisableLockWorkstation','DisableChangePassword'
foreach ($u in $sel) {
  $root = "Registry::HKEY_USERS\$($u.Sid)"
  $loaded = $false
  if (-not (Test-Path $root)) { & reg.exe load "HKU\$($u.Sid)" "$($u.Path)\NTUSER.DAT" | Out-Null; $loaded = $true }
  $exp = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
  $sys = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\System"
  $wl = "$root\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
  $gc = "$root\Software\Policies\Google\Chrome"
  if ($Unlock) {
    Remove-Item -Path $gc -Recurse -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $wl -Name 'Shell' -ErrorAction SilentlyContinue
    foreach ($v in $expVals) { Remove-ItemProperty -Path $exp -Name $v -ErrorAction SilentlyContinue }
    Remove-Item -Path "$exp\RestrictRun" -Recurse -ErrorAction SilentlyContinue
    foreach ($v in $sysVals) { Remove-ItemProperty -Path $sys -Name $v -ErrorAction SilentlyContinue }
    Write-Host ("UNLOCKED: " + $u.Name) -ForegroundColor Green
  } else {
    New-Item -Path $exp -Force | Out-Null
    New-Item -Path $sys -Force | Out-Null
    foreach ($v in $expVals) { New-ItemProperty -Path $exp -Name $v -Value 1 -PropertyType DWord -Force | Out-Null }
    New-Item -Path "$exp\RestrictRun" -Force | Out-Null
    $i = 1
    foreach ($app in 'chrome.exe','wscript.exe','cmd.exe') { New-ItemProperty -Path "$exp\RestrictRun" -Name "$i" -Value $app -PropertyType String -Force | Out-Null; $i++ }
    foreach ($v in $sysVals) { New-ItemProperty -Path $sys -Name $v -Value 1 -PropertyType DWord -Force | Out-Null }
    # Chrome for this user: only the register sites, no incognito, no dev tools, no settings
    Remove-Item -Path $gc -Recurse -ErrorAction SilentlyContinue
    New-Item -Path "$gc\URLBlocklist" -Force | Out-Null
    New-ItemProperty -Path "$gc\URLBlocklist" -Name '1' -Value '*' -PropertyType String -Force | Out-Null
    New-Item -Path "$gc\URLAllowlist" -Force | Out-Null
    $i = 1
    foreach ($h in @('${appHost}', 'supabase.co', 'matara.pro', 'nedarimplus.co.il', 'nedarim.org.il', 'www.google.com/recaptcha', 'www.gstatic.com/recaptcha', 'www.recaptcha.net', 'recaptcha.google.com', 'blob:*', 'data:*')) { New-ItemProperty -Path "$gc\URLAllowlist" -Name "$i" -Value $h -PropertyType String -Force | Out-Null; $i++ }
    # the small customer display (USB/COM) works without asking
    New-Item -Path "$gc\SerialAllowAllPortsForUrls" -Force | Out-Null
    New-ItemProperty -Path "$gc\SerialAllowAllPortsForUrls" -Name '1' -Value 'https://${appHost}' -PropertyType String -Force | Out-Null
    foreach ($kv in @(@('IncognitoModeAvailability', 1), @('DeveloperToolsAvailability', 2), @('BrowserAddPersonEnabled', 0), @('BrowserGuestModeEnabled', 0), @('PasswordManagerEnabled', 0), @('PromptForDownloadLocation', 0))) {
      New-ItemProperty -Path $gc -Name $kv[0] -Value $kv[1] -PropertyType DWord -Force | Out-Null
    }
    # the register replaces the Windows desktop for this user (no taskbar / desktop / start)
    New-Item -Path $wl -Force | Out-Null
    $sf = Join-Path $u.Path 'AppData\Local\TatbusKiosk-run\tatbus-shell.vbs'
    New-ItemProperty -Path $wl -Name 'Shell' -Value ('wscript.exe "' + $sf + '"') -PropertyType String -Force | Out-Null
    Write-Host ("LOCKED: " + $u.Name) -ForegroundColor Green
    Write-Host 'This user now sees ONLY the register. Manager exit (Ctrl+Shift+Q) signs out.' 
    Write-Host 'Copy unlock-kiosk.bat + kiosk-lock.ps1 to a USB stick.'
  }
  if ($loaded) { [gc]::Collect(); Start-Sleep 1; & reg.exe unload "HKU\$($u.Sid)" | Out-Null }
}
Write-Host 'Sign out and sign in again with that user.'
`)

const elevateBat = (arg) =>
  crlf(`@echo off
REM Needs an administrator password (Windows will ask). You pick the user from a list.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kiosk-lock.ps1" ${arg}
pause
`)
const lockBat = elevateBat('')
const unlockBat = elevateBat('-Unlock')

const readme = crlf(`TATBUS - LOCKED REGISTER FOR WINDOWS
====================================
1. Create a separate standard Windows user for the register (e.g. "Kupa").
2. Sign in as that user, make sure Google Chrome is installed.
3. Extract ALL files from this zip into one folder.
4. Double-click install-kiosk.bat
   The register opens full screen. Log in once with the canteen email.

5. (Recommended) Double-click lock-kiosk.bat. Windows asks for an ADMIN
   password - type it. Pick the REGISTER user from the list (admin users
   are never locked), type YES. Then sign out and sign in again.
   This blocks the Windows key, Task Manager, Settings and all programs
   except the register - for this user only.
   Copy unlock-kiosk.bat + kiosk-lock.ps1 to a USB stick and delete
   unlock-kiosk.bat from the computer.

Manager exit:     Ctrl+Shift+Q inside the register + manager PIN
                  (when locked: this signs the user out)
Reopen register:  double-click "Tatbus" on the desktop (when not locked)
When locked:      there is no desktop at all - only the register.
                  Alt+F4 / closing just reopens it within 2-3 seconds.
Unlock Windows:   run unlock-kiosk.bat from the USB stick, pick the user (0 = all)
Remove:           unlock first, then run uninstall-kiosk.bat (as the register user)
Emergency:        sign in with your admin user - nothing is locked there.
`)

// ---------- כתיבת ZIP פשוט (ללא דחיסה) ----------
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeZip(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  const d = new Date()
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(6, 0, true)
    lh.setUint16(8, 0, true)
    lh.setUint16(10, dosTime, true)
    lh.setUint16(12, dosDate, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, data.length, true)
    lh.setUint32(22, data.length, true)
    lh.setUint16(26, name.length, true)
    lh.setUint16(28, 0, true)
    parts.push(new Uint8Array(lh.buffer), name, data)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)
    ch.setUint16(6, 20, true)
    ch.setUint16(8, 0, true)
    ch.setUint16(10, 0, true)
    ch.setUint16(12, dosTime, true)
    ch.setUint16(14, dosDate, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, data.length, true)
    ch.setUint32(24, data.length, true)
    ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    central.push(new Uint8Array(ch.buffer), name)
    offset += 30 + name.length + data.length
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

export function kioskFiles(origin = location.origin) {
  const url = origin.replace(/\/$/, '') + '/?kiosk=1'
  return [
    { name: 'install-kiosk.bat', data: installBat },
    { name: 'tatbus-kiosk.bat', data: launcherBat(url) },
    { name: 'tatbus-start.vbs', data: hiddenVbs },
    { name: 'tatbus-shell.vbs', data: shellVbs },
    { name: 'uninstall-kiosk.bat', data: uninstallBat },
    { name: 'lock-kiosk.bat', data: lockBat },
    { name: 'kiosk-lock.ps1', data: lockPs1(new URL(origin).host) },
    { name: 'unlock-kiosk.bat', data: unlockBat },
    { name: 'README.txt', data: readme },
  ]
}

export function downloadKioskZip() {
  const blob = makeZip(kioskFiles())
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'tatbus-kiosk.zip'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
}
