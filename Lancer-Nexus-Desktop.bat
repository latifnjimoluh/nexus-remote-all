@echo off
title Nexus Remote All — Application Bureau
chcp 65001 >nul
color 0b
cls
echo ======================================================================
echo       🌐 NEXUS REMOTE ALL — APPLICATION BUREAU NATIVE (ELECTRON)
echo ======================================================================
echo.
echo   Ouverture de la fenetre de controle Nexus Remote All...
echo.

cd /d "%~dp0"

:: Verification de Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas detecte sur cette machine.
    pause
    exit /b 1
)

:: Lancement de l'application Electron dans la session graphique Windows
start "" npx electron desktop
exit
