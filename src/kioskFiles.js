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
set URL=${url}
set PROFILE=%LOCALAPPDATA%\\TatbusKiosk
set FLAGDIR=%USERPROFILE%\\Downloads

set CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" set CHROME=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe
if not exist "%CHROME%" exit /b 1

REM already running? (prevents a second copy)
powershell -NoProfile -WindowStyle Hidden -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*TatbusKiosk*' }) { exit 1 } else { exit 0 }"
if errorlevel 1 exit /b 0

del /q "%FLAGDIR%\\tatbus-exit*.flag" 2>nul
timeout /t 3 /nobreak >nul

:loop
start "" /wait "%CHROME%" --kiosk "%URL%" --user-data-dir="%PROFILE%" --no-first-run --disable-session-crashed-bubble --disable-features=Translate --overscroll-history-navigation=0 --disable-pinch
timeout /t 2 /nobreak >nul
if exist "%FLAGDIR%\\tatbus-exit*.flag" goto managerexit
goto loop

:managerexit
del /q "%FLAGDIR%\\tatbus-exit*.flag" 2>nul
exit /b 0
`)
}

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
set RUN=%LOCALAPPDATA%\\TatbusKiosk-run
set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
if not exist "%RUN%" mkdir "%RUN%"
copy /Y "%~dp0tatbus-kiosk.bat" "%RUN%\\tatbus-kiosk.bat" >nul || goto fail
copy /Y "%~dp0tatbus-start.vbs" "%RUN%\\tatbus-start.vbs" >nul || goto fail
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
set STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup
del "%STARTUP%\\tatbus-start.vbs" 2>nul
del "%STARTUP%\\tatbus-kiosk.bat" 2>nul
del "%USERPROFILE%\\Desktop\\Tatbus.vbs" 2>nul
del "%USERPROFILE%\\Desktop\\Tatbus.bat" 2>nul
rmdir /s /q "%LOCALAPPDATA%\\TatbusKiosk-run" 2>nul
echo Removed. After sign-out / sign-in the computer opens normally.
echo (The register data in %LOCALAPPDATA%\\TatbusKiosk was kept.)
pause
`)

const readme = crlf(`TATBUS - LOCKED REGISTER FOR WINDOWS
====================================
1. Create a separate standard Windows user for the register (e.g. "Kupa").
2. Sign in as that user, make sure Google Chrome is installed.
3. Extract ALL files from this zip into one folder.
4. Double-click install-kiosk.bat
   The register opens full screen. Log in once with the canteen email.

Manager exit:     Ctrl+Shift+Q inside the register + manager PIN
Reopen register:  double-click "Tatbus" on the desktop
Remove:           run uninstall-kiosk.bat (as the register user)
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
    { name: 'uninstall-kiosk.bat', data: uninstallBat },
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
