@echo off
chcp 65001 >nul
title Nexus Remote All - Application Bureau
color 0b
cls
echo ======================================================================
echo       NEXUS REMOTE ALL - APPLICATION BUREAU NATIVE (INSTALLABLE)
echo ======================================================================
echo.
echo   Lancement de l'application bureau Nexus Remote All...
echo.

set "INSTALLED_EXE=%LOCALAPPDATA%\Programs\Nexus Remote All\Nexus Remote All.exe"
set "UNPACKED_EXE=%~dp0desktop\release\win-unpacked\Nexus Remote All.exe"

if exist "%INSTALLED_EXE%" (
    echo [OK] Lancement de l'application installee :
    echo      "%INSTALLED_EXE%"
    start "" "%INSTALLED_EXE%"
    timeout /t 2 >nul
    exit /b 0
)

if exist "%UNPACKED_EXE%" (
    echo [OK] Lancement de la version portable :
    echo      "%UNPACKED_EXE%"
    start "" "%UNPACKED_EXE%"
    timeout /t 2 >nul
    exit /b 0
)

echo [INFO] Lancement via Electron...
cd /d "%~dp0"
start "" npx electron desktop
exit /b 0
