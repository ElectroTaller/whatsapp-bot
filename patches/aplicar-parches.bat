@echo off
echo ============================================================
echo   APLICANDO PARCHES MANUALES - WorkFlowTaller Bot
echo ============================================================
echo.

SET "ORIGEN=%~dp0Utils.js.patched"
SET "DESTINO=%~dp0..\node_modules\whatsapp-web.js\src\util\Injected\Utils.js"

IF NOT EXIST "%ORIGEN%" (
    echo [ERROR] No se encontro el archivo parcheado: Utils.js.patched
    echo         Asegurate de que este en la carpeta: patches\
    pause
    exit /b 1
)

IF NOT EXIST "%DESTINO%" (
    echo [ERROR] No se encontro la libreria instalada en node_modules.
    echo         Ejecuta primero: npm install
    pause
    exit /b 1
)

echo [1/1] Copiando parche de Utils.js...
copy /Y "%ORIGEN%" "%DESTINO%" >nul

IF %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Parche aplicado correctamente.
    echo      Archivo destino: node_modules\whatsapp-web.js\src\util\Injected\Utils.js
) ELSE (
    echo.
    echo [ERROR] No se pudo copiar el archivo. Verifica permisos.
)

echo.
echo ============================================================
pause
