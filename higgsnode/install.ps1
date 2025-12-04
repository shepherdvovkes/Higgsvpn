# HiggsNode Автоматический сценарий установки для Windows 11/10
# Запустите этот скрипт от имени администратора

<#
.SYNOPSIS
    Автоматическая установка и настройка HiggsNode для Windows

.DESCRIPTION
    Этот скрипт автоматически:
    - Проверяет все требования
    - Устанавливает зависимости
    - Настраивает окружение
    - Проверяет сетевые настройки
    - Готовит систему к запуску

.PARAMETER SkipChecks
    Пропустить проверки требований (не рекомендуется)

.PARAMETER AutoStart
    Автоматически запустить ноду после установки

.EXAMPLE
    .\install.ps1
    Полная установка с проверками

.EXAMPLE
    .\install.ps1 -AutoStart
    Установка и автоматический запуск
#>

param(
    [switch]$SkipChecks,
    [switch]$AutoStart,
    [switch]$SkipWireGuardCheck,
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

# Переход в директорию скрипта
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($scriptPath) {
    Set-Location $scriptPath
}

# Цвета для вывода
function Write-Step {
    param([string]$Message)
    Write-Host "`n[$Message]" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor Gray
}

# Заголовок
Clear-Host
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  HiggsNode - Автоматическая установка" -ForegroundColor Cyan
Write-Host "  для Windows 11/10" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Проверка прав администратора
Write-Step "Проверка прав доступа"
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-ErrorMsg "Скрипт должен быть запущен от имени администратора!"
    Write-Info "Щелкните правой кнопкой мыши на PowerShell и выберите 'Запуск от имени администратора'"
    exit 1
}
Write-Success "Права администратора подтверждены"

# Проверка версии Windows
Write-Step "Проверка версии Windows"
$osVersion = [System.Environment]::OSVersion.Version
$osInfo = Get-CimInstance Win32_OperatingSystem
Write-Info "Версия ОС: $($osInfo.Caption) $($osInfo.Version)"
if ($osVersion.Major -lt 10) {
    Write-ErrorMsg "Требуется Windows 10 или выше"
    exit 1
}
Write-Success "Версия Windows совместима"

# Проверка Node.js
if (-not $SkipNodeCheck -and -not $SkipChecks) {
    Write-Step "Проверка Node.js"
    try {
        $nodeVersion = node --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Node.js найден: $nodeVersion"
            $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
            if ($majorVersion -lt 20) {
                Write-Warning "Рекомендуется Node.js 20.x или выше (текущая версия: $majorVersion.x)"
                Write-Info "Скачайте с https://nodejs.org/"
            }
        } else {
            throw "Node.js not found"
        }
    } catch {
        Write-ErrorMsg "Node.js не найден!"
        Write-Info "Установите Node.js 20.x или выше с https://nodejs.org/"
        Write-Info "После установки перезапустите этот скрипт"
        exit 1
    }
}

# Проверка npm
Write-Step "Проверка npm"
try {
    $npmVersion = npm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "npm найден: v$npmVersion"
    } else {
        throw "npm not found"
    }
} catch {
    Write-ErrorMsg "npm не найден!"
    Write-Info "npm должен быть установлен вместе с Node.js"
    exit 1
}

# Проверка WireGuard
if (-not $SkipWireGuardCheck -and -not $SkipChecks) {
    Write-Step "Проверка WireGuard"
    $wgPath = "${env:ProgramFiles}\WireGuard\wg.exe"
    $wgQuickPath = "${env:ProgramFiles}\WireGuard\wg-quick.exe"
    
    if (Test-Path $wgPath) {
        try {
            $wgOutput = & $wgPath --version 2>&1
            Write-Success "WireGuard найден: $wgOutput"
        } catch {
            Write-Warning "WireGuard найден, но может работать некорректно"
        }
    } else {
        Write-ErrorMsg "WireGuard не найден!"
        Write-Info "Установите WireGuard с https://www.wireguard.com/install/"
        Write-Info "После установки перезагрузите компьютер и запустите скрипт снова"
        Write-Info ""
        Write-Info "Для продолжения без проверки WireGuard используйте:"
        Write-Info "  .\install.ps1 -SkipWireGuardCheck"
        exit 1
    }
}

# Проверка сетевых интерфейсов
Write-Step "Проверка сетевых интерфейсов"
try {
    $interfaces = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notlike "*WireGuard*" -and $_.InterfaceDescription -notlike "*VPN*" }
    if ($interfaces.Count -gt 0) {
        Write-Success "Найдено активных сетевых интерфейсов: $($interfaces.Count)"
        foreach ($iface in $interfaces) {
            $ip = (Get-NetIPAddress -InterfaceIndex $iface.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
            if ($ip) {
                Write-Info "  - $($iface.Name): $ip"
            }
        }
    } else {
        Write-Warning "Не найдено активных сетевых интерфейсов"
    }
} catch {
    Write-Warning "Не удалось проверить сетевые интерфейсы: $_"
}

# Проверка IP Forwarding
Write-Step "Проверка IP Forwarding"
try {
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters"
    $ipForwarding = Get-ItemProperty -Path $regPath -Name "IPEnableRouter" -ErrorAction SilentlyContinue
    if ($ipForwarding -and $ipForwarding.IPEnableRouter -eq 1) {
        Write-Success "IP Forwarding уже включен"
    } else {
        Write-Info "IP Forwarding будет включен при первом запуске ноды"
        Write-Info "Может потребоваться перезагрузка после первого запуска"
    }
} catch {
    Write-Warning "Не удалось проверить IP Forwarding: $_"
}

# Установка зависимостей
Write-Step "Установка зависимостей npm"
if (Test-Path "package.json") {
    Write-Info "Запуск npm install..."
    $npmInstallResult = npm install --no-audit --no-fund 2>&1
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq $null) {
        Write-Success "Зависимости установлены"
    } else {
        Write-ErrorMsg "Не удалось установить зависимости"
        Write-Info "Попробуйте запустить вручную: npm install"
        exit 1
    }
} else {
    Write-ErrorMsg "Файл package.json не найден!"
    Write-Info "Убедитесь, что вы находитесь в директории higgsnode"
    exit 1
}

# Сборка проекта
Write-Step "Сборка проекта"
Write-Info "Запуск npm run build..."
$buildResult = npm run build 2>&1
if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq $null) {
    Write-Success "Проект успешно собран"
} else {
    Write-ErrorMsg "Не удалось собрать проект"
    Write-Info "Проверьте ошибки выше и исправьте их"
    exit 1
}

# Настройка .env файла
Write-Step "Настройка конфигурации"
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Success "Created .env file from .env.example"
        Write-Info "You can edit .env to configure settings"
    } else {
        Write-Warning ".env.example not found, creating basic .env"
        $envLines = @(
            "# HiggsNode Configuration",
            "BOSON_SERVER_URL=https://mail.highfunk.uk",
            "LOG_LEVEL=info",
            "LOG_FILE=logs/higgsnode.log",
            "WG_INTERFACE_NAME=higgsnode",
            "WG_PORT=51820",
            "WG_ADDRESS=10.0.0.1/24"
        )
        $envLines | Out-File -FilePath ".env" -Encoding utf8
        Write-Success "Created basic .env file"
    }
} else {
    Write-Success ".env file already exists"
    Write-Info "Existing file will not be overwritten"
}

# Создание директорий
Write-Step "Создание необходимых директорий"
$directories = @("logs", "dist")
foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Success "Created directory: $dir"
    } else {
        Write-Info "Directory already exists: $($dir)"
    }
}

# Проверка после установки
Write-Step "Проверка установки"
$checks = @{
    "package.json" = Test-Path "package.json"
    "node_modules" = Test-Path "node_modules"
    "dist/index.js" = Test-Path "dist/index.js"
    ".env" = Test-Path ".env"
    "logs" = Test-Path "logs"
}

$allPassed = $true
foreach ($check in $checks.GetEnumerator()) {
    if ($check.Value) {
        Write-Success "$($check.Key): OK"
    } else {
        Write-ErrorMsg "$($check.Key): NOT FOUND"
        $allPassed = $false
    }
}

if (-not $allPassed) {
    Write-ErrorMsg "Some checks failed. Installation may be incomplete."
    exit 1
}

# Итоговая информация
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Установка завершена успешно!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit .env file if needed" -ForegroundColor White
Write-Host "2. Start node as Administrator:" -ForegroundColor White
Write-Host "   npm start" -ForegroundColor Yellow
Write-Host ""
Write-Host "Important:" -ForegroundColor Yellow
Write-Host "- IP Forwarding will be enabled on first run" -ForegroundColor White
Write-Host "- Reboot may be required after first run" -ForegroundColor White
Write-Host "- Node will automatically configure routing and Firewall" -ForegroundColor White
Write-Host ""

# Auto start
if ($AutoStart) {
    Write-Host "Starting node automatically..." -ForegroundColor Cyan
    Write-Host ""
    Start-Sleep -Seconds 2
    npm start
}
