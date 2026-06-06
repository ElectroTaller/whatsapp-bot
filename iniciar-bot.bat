@echo off
title Bot de WhatsApp - WorkFlowTaller
color 0A
echo ============================================================
echo   BOT DE WHATSAPP - ELECTROTALLER
echo   Auto-reinicio activado
echo ============================================================
echo.
echo [INFO] Iniciando servidor...
echo [INFO] Si ves el codigo QR, escanea con tu WhatsApp.
echo [INFO] Cierra esta ventana para apagar el bot.
echo.
"C:\Program Files\nodejs\node.exe" "%~dp0index.js"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] El bot se cerro con error. Reiniciando en 5 segundos...
    timeout /t 5 /nobreak >nul
    goto :EOF
)
pause
