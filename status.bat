@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   出入库库存管理工作台 - 状态检查
echo ============================================
echo.

:: 检查端口
netstat -ano 2>nul | findstr ":3000 " >nul
if errorlevel 1 (
    echo  [状态] 服务未运行 ❌
    echo.
    echo  请双击 start.bat 启动服务
    pause
    exit /b
) else (
    echo  [状态] 服务运行中 ✅
)

:: 获取PID
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do set pid=%%a
echo  [进程] PID: %pid%

:: 获取占用内存
for /f "tokens=5" %%b in ('tasklist /NH /FI "PID eq %pid%" 2^>nul ^| findstr "."') do echo  [内存] %%b

echo.
echo  ============ 访问地址 ============
echo.
echo   [电脑端]  http://localhost:3000
echo.
echo   [手机端]  以下是本机局域网IP地址
echo             请在手机浏览器输入以下任一地址：
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "ip=%%a"
    setlocal enabledelayedexpansion
    echo     http://!ip:~1!:3000
    endlocal
)

echo.
echo  ============ 相关操作 ============
echo.
echo   stop.bat     - 停止服务
echo   restart.bat  - 重启服务
echo   start.bat    - 启动服务
echo.
echo   logs\server.log - 运行日志
echo.
pause