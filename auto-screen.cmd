@echo off
setlocal
cd /d "%~dp0"

:menu
cls
echo Auto-Screen - utilitario local
echo.
echo 1. Instalar dependencias
echo 2. Compilar e verificar tipos
echo 3. Rodar testes seguros
echo 4. Diagnosticar ambiente
echo 5. Preparar SoundFont da demonstracao
echo 6. Gravar demonstracao com controle do mouse
echo 7. Validar skills
echo 8. Inspecionar pacote npm
echo 0. Sair
echo.
set /p choice=Escolha:

if "%choice%"=="1" call npm install
if "%choice%"=="2" call npm run typecheck && call npm run build
if "%choice%"=="3" call npm test
if "%choice%"=="4" call npm run doctor
if "%choice%"=="5" call npm run demo:setup
if "%choice%"=="6" call npm run demo
if "%choice%"=="7" call npm run validate:skills
if "%choice%"=="8" call npm run pack:check
if "%choice%"=="0" exit /b 0

echo.
pause
goto menu
