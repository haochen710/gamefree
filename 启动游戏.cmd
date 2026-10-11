@echo off
setlocal
title 仙途 · 本地开发服务器

:: ============================================================
::  注意：这个文件必须以 GBK(936) + CRLF 保存。
::  cmd.exe 是按当前代码页解析批处理文件的，存成 UTF-8 会导致
::  中文乱码，甚至整行被误判成命令。
::
::  下面所有中文提示都放在切换代码页之前；切换成 UTF-8 之后
::  只使用纯 ASCII 文本 —— ASCII 在两种编码下字节相同，
::  所以中途切代码页不会把后续内容读乱。
:: ============================================================

cd /d "%~dp0"

echo.
echo    ==============================================
echo              仙 途 · 修 仙 放 置 游 戏
echo    ==============================================
echo.

:: ---------- 环境检查 ----------

if not exist "package.json" (
    echo    [错误] 这个目录里没有 package.json
    echo.
    echo    请把「启动游戏.cmd」放在项目根目录下，
    echo    也就是和 package.json、src 文件夹放在一起。
    echo.
    echo    当前目录：%CD%
    echo.
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo    [错误] 找不到 pnpm 命令
    echo.
    echo    请先安装 Node.js，然后在命令行执行：
    echo        npm install -g pnpm
    echo.
    pause
    exit /b 1
)

:: ---------- 已经在运行就不重复启动 ----------

netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo    开发服务器已经在运行了，直接打开浏览器……
    start http://localhost:5173/gamefree/
    echo.
    echo    如果要重启，请先关掉原来那个命令行窗口。
    echo.
    pause
    exit /b 0
)

:: ---------- 首次运行装依赖 ----------

if not exist "node_modules" (
    echo    首次运行，正在安装依赖……
    echo    这一步可能要几分钟，请耐心等待。
    echo.
    call pnpm install
    if errorlevel 1 (
        echo.
        echo    [错误] 依赖安装失败，请检查网络后重新双击本脚本。
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo    正在启动开发服务器……
echo.
echo    网  址：http://localhost:5173/gamefree/
echo.
echo    ----------------------------------------------
echo     停止服务器：在此窗口按 Ctrl+C
echo     修改代码会自动热更新，不需要重启
echo    ----------------------------------------------
echo.

:: ============================================================
::  ASCII ONLY BELOW THIS LINE. No Chinese characters past here.
:: ============================================================

:: Poll until the dev server responds, then open the browser.
:: Polling instead of a fixed delay, so a slow machine will not
:: open an unreachable page.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){try{[void](Invoke-WebRequest -Uri 'http://localhost:5173/gamefree/' -UseBasicParsing -TimeoutSec 2); Start-Process 'http://localhost:5173/gamefree/'; break}catch{Start-Sleep -Milliseconds 500}}"

:: Switch to UTF-8 so Vite's own colored output renders correctly.
chcp 65001 >nul 2>&1

call pnpm dev

echo.
echo    Server stopped. Press any key to close this window.
pause >nul
