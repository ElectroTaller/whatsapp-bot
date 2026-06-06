@echo off
echo ========================================================
echo Limpiando cache de sesion del Bot de WhatsApp...
echo ========================================================
cd /d "%~dp0"
if exist ".wwebjs_auth" (
    rmdir /s /q ".wwebjs_auth"
    echo [OK] Cache eliminado. Tendras que escanear el QR nuevamente.
) else (
    echo [INFO] No habia cache guardado.
)
echo.
echo Presiona cualquier tecla para iniciar el bot de nuevo...
pause >nul
"C:\Program Files\nodejs\node.exe" index.js
pause
