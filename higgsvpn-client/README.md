# HiggsVPN Client для macOS

Клиентское приложение для подключения к децентрализованной VPN сети Higgs.net.

## Установка

```bash
npm install
npm run build
```

## Запуск

Перед запуском клиента убедитесь, что BosonServer запущен и доступен:

```bash
# Запустить BosonServer (в другой директории)
cd ../bosonserver
docker-compose up -d
# или
npm run dev
```

Затем запустите клиент:

```bash
npm start
```

Или в режиме разработки:

```bash
npm run dev
```

## Конфигурация

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Основные параметры:
- `BOSONSERVER_URL` - URL сервера (по умолчанию: http://localhost:3000)
- `CLIENT_ID` - ID клиента (оставьте пустым для автогенерации)
- `WG_INTERFACE` - Имя WireGuard интерфейса
- `WG_ADDRESS` - IP адрес для WireGuard
- `LOG_LEVEL` - Уровень логирования (info, debug, error)

## Тестирование

Запустить все тесты:

```bash
npm test
```

Запустить тесты в режиме watch:

```bash
npm run test:watch
```

Запустить тесты с покрытием:

```bash
npm run test:coverage
```

## Архитектура

### Компоненты

- **ClientService** - Основной сервис для управления подключением к VPN
- **ApiClient** - Клиент для взаимодействия с BosonServer API
- **WebSocketRelay** - WebSocket клиент для передачи данных через relay

### Процесс подключения

1. Проверка здоровья сервера (`/health`)
2. Определение локального IP адреса
3. Запрос маршрута (`POST /api/v1/routing/request`)
4. Подключение к WebSocket relay
5. Установление соединения и начало передачи данных

## Использование

### Базовое использование

```typescript
import { ClientService } from './services/ClientService';

const client = new ClientService();

client.on('connected', (status) => {
  console.log('Connected!', status);
});

client.on('error', (error) => {
  console.error('Error:', error);
});

await client.connect({
  minBandwidth: 10,
  maxLatency: 100,
});
```

### Отправка пакетов

```typescript
const packet = Buffer.from('data');
client.sendPacket(packet);
```

### Отключение

```typescript
await client.disconnect();
```

## Разработка

### Структура проекта

```
higgsvpn-client/
├── src/
│   ├── config/        # Конфигурация
│   ├── services/     # Основные сервисы
│   ├── utils/        # Утилиты
│   └── index.ts      # Точка входа
├── tests/            # Тесты
└── dist/             # Скомпилированный код
```

### Сборка

```bash
npm run build
```

### Проверка типов

```bash
npm run type-check
```

### Линтинг

```bash
npm run lint
```

## Требования

- Node.js >= 20.0.0
- npm >= 10.0.0
- Запущенный BosonServer

## Лицензия

MIT

