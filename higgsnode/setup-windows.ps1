# HiggsNode Windows Setup Script
# Run this script as Administrator to set up HiggsNode on Windows 11/10

param(
    [switch]$SkipWireGuardCheck,
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = "Stop"

Write-Host "HiggsNode Windows Setup" -ForegroundColor Cyan
Write-Host "=======================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Running as Administrator" -ForegroundColor Green

# Check Node.js
if (-not $SkipNodeCheck) {
    Write-Host ""
    Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
    try {
        $nodeVersion = node --version
        Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
        
        $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
        if ($majorVersion -lt 20) {
            Write-Host "WARNING: Node.js 20.x or higher is recommended" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "ERROR: Node.js not found!" -ForegroundColor Red
        Write-Host "Please install Node.js 20.x or higher from https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
}

# Check WireGuard
if (-not $SkipWireGuardCheck) {
    Write-Host ""
    Write-Host "Checking WireGuard installation..." -ForegroundColor Yellow
    $wgPath = "${env:ProgramFiles}\WireGuard\wg.exe"
    if (Test-Path $wgPath) {
        try {
            $wgVersion = & $wgPath --version 2>&1
            Write-Host "✓ WireGuard found: $wgVersion" -ForegroundColor Green
        } catch {
            Write-Host "WARNING: WireGuard found but may not be working correctly" -ForegroundColor Yellow
        }
    } else {
        Write-Host "ERROR: WireGuard not found!" -ForegroundColor Red
        Write-Host "Please install WireGuard from https://www.wireguard.com/install/" -ForegroundColor Yellow
        Write-Host "After installation, restart your computer and run this script again." -ForegroundColor Yellow
        exit 1
    }
}

# Check npm
Write-Host ""
Write-Host "Checking npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version
    Write-Host "✓ npm found: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: npm not found!" -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host ""
Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
try {
    npm install
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Build project
Write-Host ""
Write-Host "Building project..." -ForegroundColor Yellow
try {
    npm run build
    Write-Host "✓ Project built successfully" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to build project" -ForegroundColor Red
    exit 1
}

# Setup .env file
Write-Host ""
Write-Host "Setting up configuration..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✓ Created .env from .env.example" -ForegroundColor Green
        Write-Host "  You may want to edit .env to customize settings" -ForegroundColor Cyan
    } else {
        Write-Host "WARNING: .env.example not found, creating basic .env" -ForegroundColor Yellow
        @"
BOSON_SERVER_URL=https://mail.highfunk.uk
LOG_LEVEL=info
LOG_FILE=logs/higgsnode.log
"@ | Out-File -FilePath ".env" -Encoding utf8
        Write-Host "✓ Created basic .env file" -ForegroundColor Green
    }
} else {
    Write-Host "✓ .env file already exists" -ForegroundColor Green
}

# Create logs directory
Write-Host ""
Write-Host "Creating logs directory..." -ForegroundColor Yellow
if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" -Force | Out-Null
    Write-Host "✓ Logs directory created" -ForegroundColor Green
} else {
    Write-Host "✓ Logs directory already exists" -ForegroundColor Green
}

# Summary
Write-Host ""
Write-Host "Setup completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Review and edit .env file if needed" -ForegroundColor White
Write-Host "2. Run 'npm start' as Administrator to start HiggsNode" -ForegroundColor White
Write-Host ""
Write-Host "Note: On first run, IP forwarding will be enabled." -ForegroundColor Yellow
Write-Host "      You may need to restart your computer for it to take effect." -ForegroundColor Yellow
Write-Host ""

