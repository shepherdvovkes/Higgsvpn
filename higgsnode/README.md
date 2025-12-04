# HiggsNode

Нода на ПК пользователя для децентрализованной VPN-сети Higgs.net.

## Описание

HiggsNode регистрируется на BosonServer, открывает локальный WireGuard порт, маршрутизирует трафик от клиентов и собирает метрики производительности.

## Требования

- Node.js >= 20.0.0
- WireGuard установлен на системе
- Права администратора/root для управления сетью

### Установка WireGuard

- **Windows**: [WireGuard for Windows](https://www.wireguard.com/install/) - **требуется перезагрузка после установки**
- **Linux**: `sudo apt install wireguard-tools` (Ubuntu/Debian) или `sudo yum install wireguard-tools` (RHEL/CentOS)
- **macOS**: `brew install wireguard-tools`

### Особенности Windows

Для Windows 11/10 при установке автоматически настраиваются:
- IP Forwarding (пересылка IP пакетов)
- Маршрутизация для WireGuard подсети
- Windows Firewall правила для forwarding трафика
- NAT через комбинацию маршрутизации и firewall

**Важно:** После первого запуска может потребоваться перезагрузка для применения настроек IP Forwarding.

Подробная документация: [WINDOWS_SETUP.md](WINDOWS_SETUP.md)

## Установка

### Windows (автоматическая установка)

**Быстрый старт:**
1. Установите [WireGuard для Windows](https://www.wireguard.com/install/) и перезагрузите компьютер
2. Установите [Node.js 20.x или выше](https://nodejs.org/)
3. Запустите `install.bat` от имени администратора (двойной клик → "Запуск от имени администратора")
4. Запустите `start-node.bat` от имени администратора

**Или через PowerShell:**
```powershell
# Откройте PowerShell от имени администратора
cd higgsnode
.\install.ps1          # Установка
npm start              # Запуск ноды
```

**Установка с автоматическим запуском:**
```powershell
.\install.ps1 -AutoStart
```

Документация:
- [QUICK_START.md](QUICK_START.md) - Быстрый старт
- [WINDOWS_SETUP.md](WINDOWS_SETUP.md) - Подробная документация

### Linux/macOS

```bash
npm install
npm run build
```

## Конфигурация

1. Скопируйте `.env.example` в `.env`:
```bash
# Windows
copy .env.example .env

# Linux/macOS
cp .env.example .env
```

2. Отредактируйте `.env` и укажите:
   - `BOSON_SERVER_URL` - URL BosonServer (по умолчанию: `https://mail.highfunk.uk`)
   - `NODE_ID` - UUID ноды (генерируется автоматически при первом запуске, если не указан)
   - `WG_ADDRESS` - IP адрес и подсеть WireGuard интерфейса (по умолчанию: `10.0.0.1/24`)
   - Другие параметры по необходимости

**Важно:** 
- Нода регистрируется на BosonServer при запуске
- Клиенты подключаются к ноде через BosonServer (relay)
- Трафик от клиентов маршрутизируется в интернет через физический интерфейс ноды

## Использование

### CLI команды

```bash
# Запуск ноды
# Windows: Запустите PowerShell/CMD от имени администратора
# Linux/macOS: Используйте sudo
npm start

# Или через CLI
higgsnode start

# Остановка
higgsnode stop

# Статус
higgsnode status

# Управление конфигурацией
higgsnode config set <key> <value>
higgsnode config get <key>
```

### Windows

**Важно:** На Windows обязательно запускайте от имени администратора!

1. Откройте PowerShell или CMD от имени администратора
2. Перейдите в директорию проекта
3. Запустите: `npm start`

При первом запуске будет настроено:
- IP Forwarding (может потребоваться перезагрузка)
- Маршрутизация
- Firewall правила

## Разработка

```bash
# Режим разработки с hot reload
npm run dev

# Сборка
npm run build

# Тесты
npm test

# Линтинг
npm run lint
```

## Структура проекта

```
higgsnode/
├── src/
│   ├── index.ts              # Точка входа
│   ├── config/               # Конфигурация
│   ├── managers/             # Менеджеры (Connection, WireGuard, Resource)
│   ├── engines/              # Движки (NAT Traversal, Routing)
│   ├── collectors/           # Сборщики метрик
│   ├── services/             # Сервисы (API, WebSocket, STUN)
│   ├── utils/                # Утилиты
│   └── cli/                  # CLI интерфейс
├── dist/                     # Скомпилированный код
└── logs/                     # Логи
```

## Лицензия

MIT

