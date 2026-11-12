@echo off
setlocal
cd /d "%~dp0" || exit /b 1

set "SUYAJAL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SUYAJAL_NODE%" (
    where.exe node.exe >nul 2>&1
    if errorlevel 1 (
        echo Node.js 24 is required. Install it and run this script again. 1>&2
        exit /b 1
    )
    set "SUYAJAL_NODE=node.exe"
)

if not exist ".env" (
    echo Missing .env. Copy .env.example to .env and configure the database. 1>&2
    exit /b 1
)
if not exist "node_modules\express\package.json" (
    echo Missing dependencies. Run pnpm install --frozen-lockfile first. 1>&2
    exit /b 1
)

"%SUYAJAL_NODE%" --env-file=.env server.mjs
exit /b %errorlevel%
