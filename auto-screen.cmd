@echo off
setlocal
cd /d "%~dp0"

:menu
cls
echo Auto-Screen - utilitario local
echo.
echo 1. Instalar dependencias da biblioteca
echo 2. Instalar interface humana
echo 3. Abrir interface humana
echo 4. Compilar e verificar tipos
echo 5. Rodar verificacoes e testes seguros
echo 6. Diagnosticar ambiente
echo 7. Testar captura passiva
echo 8. Preparar SoundFont da demonstracao
echo 9. Gravar demonstracao com mouse e teclado
echo 10. Validar skills
echo 11. Inspecionar pacote npm
echo 0. Sair
echo.
set /p choice=Escolha:

if "%choice%"=="1" call npm install
if "%choice%"=="2" call npm run app:install
if "%choice%"=="3" call npm run app
if "%choice%"=="4" call npm run typecheck && call npm run build
if "%choice%"=="5" call npm run check
if "%choice%"=="6" call npm run doctor
if "%choice%"=="7" call npm run test:capture
if "%choice%"=="8" call npm run demo:setup
if "%choice%"=="9" call npm run demo
if "%choice%"=="10" call npm run validate:skills
if "%choice%"=="11" call npm run pack:check
if "%choice%"=="0" exit /b 0

echo.
pause
goto menu
