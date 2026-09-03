@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   出入库库存管理工作台 - 停止服务
echo ============================================
echo.

:: 查找占用3000端口的进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    set "pid=%%a"
    setlocal enabledelayedexpansion
    echo [1/2] 发现服务进程 PID: !pid!
    echo [2/2] 正在停止...
    taskkill /PID !pid! /F >nul 2>&1
    if errorlevel 1 (
        echo [错误] 停止失败！尝试强制停止...
        taskkill /PID !pid! /F >nul 2>&1
    )
    echo [完成] 服务已停止。
    endlocal
    goto :done
)

echo [信息] 服务未在运行（端口3000未被占用）。
echo.

:done
echo.
echo ============================================
echo.
echo  如需重新启动，请双击 start.bat
echo.
pause