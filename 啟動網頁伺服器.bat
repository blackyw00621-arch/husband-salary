@echo off
chcp 65001 > nul
echo ===================================================
echo             俊賢工作薪水記錄表 - 本地網頁伺服器
echo ===================================================
echo.
echo 正在偵測系統環境...

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] 偵測到 Node.js，正在使用 npx http-server 啟動...
    echo.
    echo 🚀 網頁伺服器已啟動！
    echo 👉 請開啟瀏覽器前往： http://127.0.0.1:8000
    echo.
    echo (注意：若要使用本機資料庫，請同時執行「測試啟動.bat」)
    echo ---------------------------------------------------
    npx -y http-server . -p 8000
    goto end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] 偵測到 Python，正在使用 python http.server 啟動...
    echo.
    echo 🚀 網頁伺服器已啟動！
    echo 👉 請開啟瀏覽器前往： http://127.0.0.1:8000
    echo.
    echo (注意：若要使用本機資料庫，請同時執行「測試啟動.bat」)
    echo ---------------------------------------------------
    python -m http.server 8000
    goto end
)

echo ❌ [錯誤] 系統未偵測到 Node.js 或 Python，無法在此建立本地伺服器。
echo.
echo 💡 解決方法：
echo 1. 您可以直接雙擊 index.html 開啟網頁（此模式下將連線至雲端 Fly.dev 資料庫）。
echo 2. 或請在本機安裝 Node.js (https://nodejs.org) 或 Python 後重新執行此腳本。
echo.
:end
pause
