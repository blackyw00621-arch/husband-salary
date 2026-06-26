@echo off
chcp 65001 > nul
echo 正在以 8091 連接埠啟動 PocketBase...
pocketbase.exe serve --http="0.0.0.0:8091"
echo.
echo 啟動已結束，請查看上方訊息。
pause
