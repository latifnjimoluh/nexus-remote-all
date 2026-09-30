@echo off
title Nexus Remote All — Agent PC
chcp 65001 >nul
color 0b
cls
echo ======================================================================
echo           🌐 NEXUS REMOTE ALL — AGENT PC (SERVEUR HÔTE)
echo ======================================================================
echo.
echo   Demarrage de l'agent de controle a distance...
echo.

cd /d "%~dp0"

:: Verification de Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas detecte sur cette machine.
    echo Veuillez installer Node.js (version 20+) depuis https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Activation du relais Cloud chiffré E2E (remote.unlineservice.com)
set NEXUS_CLOUD=1

:: Lancement du serveur agent avec liaison Cloud automatique
node server/dist/server/src/index.js

if %errorlevel% neq 0 (
    echo.
    echo [INFO] Le serveur s'est arrete.
    pause
)
