$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find a real Python (the Microsoft Store placeholder fails this test)
$python = $null
foreach ($c in @("py", "python")) {
    try {
        $p = & $c -c "import sys; print(sys.executable if sys.version_info >= (3, 8) else '')" 2>$null
        if ($LASTEXITCODE -eq 0 -and $p) { $python = $p.Trim(); break }
    } catch {}
}
if (-not $python) { Write-Host "Python 3.8+ not found. Install it from python.org, then run setup.bat again."; exit 1 }

Write-Host "Fetching news for the first time..."
& $python "$dir\fetch_news.py"

$pythonw = Join-Path (Split-Path $python) "pythonw.exe"
if (-not (Test-Path $pythonw)) { $pythonw = $python }
$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$dir\fetch_news.py`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 6:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun
Register-ScheduledTask -TaskName "MorningBriefNews" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Daily 6:00 AM refresh scheduled."

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$page = ([System.Uri]"$dir\news-dashboard.html").AbsoluteUri
$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Morning Brief.lnk"))
if ($browser) { $link.TargetPath = $browser; $link.Arguments = "--app=`"$page`""; $link.IconLocation = "$browser,0" }
else { $link.TargetPath = "$dir\news-dashboard.html" }
$link.Save()
Write-Host "Desktop shortcut 'Morning Brief' created."
