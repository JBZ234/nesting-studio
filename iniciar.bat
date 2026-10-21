@echo off
setlocal
cd /d "%~dp0"

rem --- Node.js ---
if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where npm >nul 2>&1
if errorlevel 1 (
  echo No se encontro Node.js. Instalando con winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo No se pudo instalar Node.js automaticamente.
  echo Descargalo de https://nodejs.org ^(version LTS^), instalalo y vuelve a abrir este archivo.
  pause
  exit /b 1
)

rem --- Rust ---
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>&1
if errorlevel 1 (
  echo No se encontro Rust. Instalando con winget...
  winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo.
  echo Falta Rust. Instalalo desde https://rustup.rs y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias ^(solo la primera vez^)...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Abriendo Nesting Studio ^(la primera compilacion de Rust tarda unos minutos^)...
call npm run tauri dev
pause
