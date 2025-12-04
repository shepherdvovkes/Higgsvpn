@echo off
REM HiggsNode - Запуск ноды
REM Запустите этот файл от имени администратора для запуска ноды

echo.
echo ========================================
echo   HiggsNode - Запуск ноды
echo ========================================
echo.

REM Проверка прав администратора
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ОШИБКА: Нода должна быть запущена от имени администратора!
    echo.
    echo Щелкните правой кнопкой мыши на этом файле и выберите
    echo "Запуск от имени администратора"
    echo.
    pause
    exit /b 1
)

REM Проверка наличия dist
if not exist "dist\index.js" (
    echo ОШИБКА: Проект не собран!
    echo.
    echo Запустите сначала install.bat или выполните:
    echo   npm run build
    echo.
    pause
    exit /b 1
)

REM Запуск ноды
echo Запуск HiggsNode...
echo.
npm start

if %errorLevel% neq 0 (
    echo.
    echo Нода завершилась с ошибками.
    pause
    exit /b 1
)

