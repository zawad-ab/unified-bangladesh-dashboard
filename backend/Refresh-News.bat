@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (python fetch_news.py) else (py fetch_news.py)
pause
