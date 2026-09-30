@echo off
chcp 65001 >nul
title Nexus Remote All - Mode Administrateur
color 0c
cls

echo ======================================================================
echo    🛡️ NEXUS REMOTE ALL - LANCEMENT EN TANT QU'ADMINISTRATEUR
echo ======================================================================
echo.
echo   Ce mode permet a la souris et au clavier de fonctionner meme sur :
echo   - Les fenetres d'installation et de validation
echo   - Le Gestionnaire des taches (Task Manager)
echo   - Les invites de commande / PowerShell Administrateur
echo.

:: Verification des droits administrateur
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Demande d'elevation des privileges Windows (UAC)...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b 0
)

echo [OK] Privileges Administrateur confirmes !
echo.

set "INSTALLED_EXE=%LOCALAPPDATA%\Programs\Nexus Remote All\Nexus Remote All.exe"
set "UNPACKED_EXE=%~dp0desktop\release\win-unpacked\Nexus Remote All.exe"

if exist "%INSTALLED_EXE%" (
    echo [OK] Lancement de l'application installee en Admin :
    echo      "%INSTALLED_EXE%"
    start "" "%INSTALLED_EXE%"
    timeout /t 2 >nul
    exit /b 0
)

if exist "%UNPACKED_EXE%" (
    echo [OK] Lancement de la version portable en Admin :
    echo      "%UNPACKED_EXE%"
    start "" "%UNPACKED_EXE%"
    timeout /t 2 >nul
    exit /b 0
)

echo [INFO] Lancement via Electron dev en Admin...
cd /d "%~dp0"
start "" npx electron desktop
exit /b 0
