@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   出入库库存管理工作台 - 启动器
echo ============================================
echo.

:: 检查端口3000是否已被占用
netstat -ano 2>nul | findstr ":3000 " >nul
if not errorlevel 1 (
    echo [信息] 服务已在运行中！
    echo.
    echo   如果无法访问，请试试：双击 stop.bat 停止，再双击 start.bat 重启
    goto :showIP
)

:: 清理旧日志（保留最近3个启动日志）
if not exist "logs\" mkdir logs
if exist "logs\server.log" (
    if exist "logs\server_old2.log" del "logs\server_old2.log" /q
    if exist "logs\server_old1.log" ren "logs\server_old1.log" server_old2.log 2>nul
    ren "logs\server.log" server_old1.log 2>nul
)

echo [1/3] 正在启动服务...
echo.

:: 后台静默启动（单独进程，关闭此窗口不影响服务运行）
start /MIN "" "%~dp0node.exe" --no-warnings server.js

:: 等待服务启动
echo 等待服务启动...
timeout /t 4 /nobreak >nul

:: 检查是否成功启动
netstat -ano 2>nul | findstr ":3000 " >nul
if errorlevel 1 (
    echo [错误] 服务启动失败！请检查 logs\server_err.txt
    pause
    exit /b
)

echo [2/3] 服务启动成功！
echo.

:showIP
echo.
echo ============ 访问地址 ============
echo.
echo   [电脑端]  http://localhost:3000
echo.
echo   [手机端]  请确保手机连接了和电脑相同的WiFi
echo.
echo   从以下地址中选一个在手机浏览器打开：
echo.

:: 获取本机局域网IP并显示
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "ip=%%a"
    setlocal enabledelayedexpansion
    echo     http://!ip:~1!:3000
    endlocal
)

echo.
echo ============================================
echo.
echo  [提示] 服务已在后台运行，可关闭此窗口。
echo  关闭后服务不会停止！
echo.
echo  [如需停止] 双击 stop.bat
echo  [如需重启] 先双击 stop.bat 再双击 start.bat
echo.
echo  查看运行日志: logs\server.log
echo.

:: 自动打开浏览器
start "" "http://localhost:3000"

:: 等待3秒后自动关闭此窗口
timeout /t 3 /nobreak >nul