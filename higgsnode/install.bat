@echo off
REM HiggsNode - Быстрый запуск установки для Windows
REM Этот файл запускает PowerShell скрипт установки

echo.
echo ========================================
echo   HiggsNode - Установка
echo ========================================
echo.

REM Проверка прав администратора
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ОШИБКА: Этот скрипт должен быть запущен от имени администратора!
    echo.
    echo Щелкните правой кнопкой мыши на этом файле и выберите
    echo "Запуск от имени администратора"
    echo.
    pause
    exit /b 1
)

REM Запуск PowerShell скрипта с правильной кодировкой
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; & '%~dp0install.ps1' %*"

if %errorLevel% neq 0 (
    echo.
    echo Установка завершилась с ошибками.
    pause
    exit /b 1
)

echo.
echo Установка завершена успешно!
pause

