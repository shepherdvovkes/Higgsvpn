# BosonServer

Центральный сервер для децентрализованной VPN-сети Higgs.net. BosonServer обеспечивает регистрацию нод, NAT traversal через STUN/TURN, маршрутизацию трафика и мониторинг системы.

## Возможности

- **Discovery Service**: Регистрация и управление нодами
- **STUN/TURN Server**: NAT traversal через coturn
- **Relay Service**: WebSocket туннелирование трафика
- **Routing Service**: Интеллектуальная маршрутизация с load balancing
- **Metrics Service**: Сбор метрик и экспорт в Prometheus
- **API Gateway**: REST API и WebSocket endpoints

## Архитектура

Все компоненты запускаются в едином Docker контейнере:
- Node.js/TypeScript приложение
- PostgreSQL (база данных)
- Redis (кэш и сессии)
- coturn (TURN/STUN сервер)
- Supervisor (управление процессами)

## Требования

- Docker и Docker Compose
- Минимум 2GB RAM
- Минимум 10GB свободного места на диске

## Быстрый старт

### Сборка и запуск

```bash
# Клонировать репозиторий
git clone <repository-url>
cd bosonserver

# Собрать Docker образ
docker build -t bosonserver .

# Запустить контейнер
docker-compose up -d
```

### Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Основные переменные:
- `POSTGRES_PASSWORD` - пароль для PostgreSQL
- `JWT_SECRET` - секретный ключ для JWT токенов
- `TURN_STATIC_SECRET` - секрет для TURN аутентификации

## API Документация

### Health Checks

```bash
# Общий health check
GET /health

# Readiness probe
GET /health/ready

# Liveness probe
GET /health/live
```

### Регистрация ноды

```bash
POST /api/v1/nodes/register
Content-Type: application/json

{
  "nodeId": "uuid",
  "publicKey": "wireguard-public-key",
  "networkInfo": {
    "ipv4": "192.168.1.1",
    "natType": "FullCone",
    "localPort": 51820
  },
  "capabilities": {
    "maxConnections": 100,
    "bandwidth": { "up": 100, "down": 100 }
  },
  "location": {
    "country": "US",
    "region": "US-CA"
  }
}
```

### Heartbeat

```bash
POST /api/v1/nodes/:nodeId/heartbeat
Authorization: Bearer <token>
Content-Type: application/json

{
  "metrics": {
    "latency": 50,
    "cpuUsage": 30,
    "activeConnections": 5
  }
}
```

### Запрос маршрута

```bash
POST /api/v1/routing/request
Content-Type: application/json

{
  "clientId": "uuid",
  "requirements": {
    "minBandwidth": 10,
    "maxLatency": 100
  },
  "clientNetworkInfo": {
    "ipv4": "192.168.1.2",
    "natType": "Symmetric"
  }
}
```

### Получение TURN серверов

```bash
GET /api/v1/turn/ice
```

### Метрики Prometheus

```bash
GET /metrics
```

Полная документация API доступна в файле `API.md`.

## Разработка

### Установка зависимостей

```bash
npm install
```

### Сборка TypeScript

```bash
npm run build
```

### Запуск в режиме разработки

```bash
npm run dev
```

### Тестирование

```bash
# Unit тесты
npm test

# С покрытием
npm test -- --coverage
```

### Линтинг

```bash
npm run lint
```

## Структура проекта

```
bosonserver/
├── src/
│   ├── api/              # API Gateway и routes
│   ├── services/         # Бизнес-логика сервисов
│   ├── database/         # Подключения к БД и миграции
│   ├── config/           # Конфигурация
│   └── utils/            # Утилиты
├── config/               # Конфигурационные файлы
├── scripts/              # Скрипты инициализации
├── tests/                # Тесты
└── Dockerfile            # Docker образ
```

## Мониторинг

### Prometheus метрики

Метрики доступны на endpoint `/metrics`:
- `bosonserver_active_nodes` - количество активных нод
- `bosonserver_active_connections` - количество активных соединений
- `bosonserver_node_latency_ms` - латентность нод
- `bosonserver_api_requests_total` - общее количество API запросов

### Логи

Логи доступны в контейнере:
- `/var/log/supervisor/bosonserver.log` - основные логи
- `/var/log/supervisor/bosonserver-error.log` - ошибки
- `/var/log/supervisor/postgresql.out.log` - логи PostgreSQL
- `/var/log/supervisor/redis.out.log` - логи Redis
- `/var/log/turnserver.log` - логи coturn

## Производительность

### Рекомендуемые ресурсы

- **CPU**: 2+ ядра
- **RAM**: 4GB+
- **Disk**: SSD предпочтительно
- **Network**: 100Mbps+

### Оптимизация

- Настройте connection pooling для PostgreSQL
- Используйте Redis для кэширования частых запросов
- Настройте rate limiting под вашу нагрузку
- Мониторьте метрики через Prometheus

## Безопасность

- Используйте сильные секреты для JWT и TURN
- Настройте firewall для ограничения доступа
- Используйте TLS для всех внешних соединений
- Регулярно обновляйте зависимости

## Troubleshooting

### Проблемы с подключением к БД

Проверьте логи PostgreSQL:
```bash
docker exec bosonserver tail -f /var/log/supervisor/postgresql.err.log
```

### Проблемы с TURN сервером

Проверьте конфигурацию coturn:
```bash
docker exec bosonserver cat /etc/turnserver.conf
```

### Проблемы с памятью

Мониторьте использование ресурсов:
```bash
docker stats bosonserver
```

## Лицензия

MIT

## Контакты

- Issue Tracker: [GitHub Issues](https://github.com/your-repo/issues)
- Документация: [Wiki](https://github.com/your-repo/wiki)

