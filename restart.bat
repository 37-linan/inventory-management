@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在重启服务...
call stop.bat
timeout /t 2 /nobreak >nul
call start.bat