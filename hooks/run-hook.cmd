@echo off
setlocal

set SCRIPT_DIR=%~dp0
set SCRIPT_NAME=%~1

if "%SCRIPT_NAME%"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

node "%SCRIPT_DIR%..\scripts\%SCRIPT_NAME%.js" %2 %3 %4 %5 %6 %7 %8 %9
