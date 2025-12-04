# Архитектура Higgs.net.uk

## Обзор системы

Higgs.net.uk — это децентрализованная VPN-сеть, построенная на пользовательских нодах за NAT. Система обеспечивает безопасное и эффективное соединение между клиентами и нодами через централизованные relay-серверы с публичными IP-адресами.

### Основные компоненты

1. **BosonServer** — центральный сервер с публичным IP для NAT traversal и маршрутизации
2. **HiggsNode** — нода на ПК пользователя для маршрутизации трафика
3. **HiggsVPN** — клиентское приложение (desktop/mobile)

---

## Архитектура компонентов

### 1. BosonServer (Центральный сервер)

#### Назначение
- Управление регистрацией и обнаружением нод
- NAT traversal через STUN/TURN протоколы
- Relay трафика между клиентами и нодами
- Маршрутизация и выбор оптимального пути
- Балансировка нагрузки
- Мониторинг и метрики

#### Структура сервисов

```
BosonServer (кластер)
├── Discovery Service
│   ├── Регистрация нод
│   ├── Хранение метаданных нод
│   ├── Heartbeat мониторинг
│   └── Health checks
│
├── STUN Service
│   ├── Определение типа NAT
│   ├── Discovery внешних адресов
│   └── NAT mapping detection
│
├── TURN/Relay Service
│   ├── Relay трафика WireGuard → API
│   ├── Relay трафика API → WireGuard
│   ├── Сессионное управление
│   └── Rate limiting
│
├── Routing Service
│   ├── Выбор оптимального маршрута
│   ├── Географическая маршрутизация
│   ├── Load balancing
│   └── Route caching
│
├── Metrics Service
│   ├── Сбор метрик от нод
│   ├── Анализ производительности
│   ├── Алертинг
│   └── Аналитика
│
└── API Gateway
    ├── REST API для нод
    ├── REST API для клиентов
    ├── WebSocket для real-time
    └── Аутентификация и авторизация
```

#### Технологии
- **Runtime**: Node.js/TypeScript
- **Framework**: Express или Fastify
- **База данных**: PostgreSQL (метаданные), Redis (кэш, сессии)
- **NAT Traversal**: coturn (TURN сервер) или собственная реализация
- **Мониторинг**: Prometheus, Grafana
- **Контейнеризация**: Docker, Kubernetes

---

### 2. HiggsNode (Нода на ПК пользователя)

#### Назначение
- Регистрация на BosonServer
- Открытие локального WireGuard порта
- Маршрутизация и NAT трафика от клиентов
- Сбор и отправка метрик
- Управление ресурсами ПК

#### Структура модулей

```
HiggsNode
├── Connection Manager
│   ├── Подключение к BosonServer
│   ├── Управление сессиями
│   ├── Автоматическое переподключение
│   └── Heartbeat отправка
│
├── NAT Traversal Engine
│   ├── STUN клиент
│   ├── ICE implementation
│   ├── UDP Hole Punching
│   └── TURN клиент (fallback)
│
├── WireGuard Manager
│   ├── Создание WG интерфейсов
│   ├── Управление ключами
│   ├── Конфигурация WG
│   └── Мониторинг соединений
│
├── Routing Engine
│   ├── Локальная маршрутизация
│   ├── NAT для клиентов
│   ├── Firewall rules
│   └── Traffic shaping
│
├── Metrics Collector
│   ├── Сетевые метрики (latency, jitter, bandwidth)
│   ├── Системные метрики (CPU, RAM, disk)
│   ├── WG метрики (packets, errors)
│   └── Real-time сбор данных
│
└── Resource Manager
    ├── Мониторинг ресурсов ПК
    ├── QoS управление
    ├── Graceful degradation
    └── Rate limiting клиентов
```

#### Технологии
- **Runtime**: Node.js/TypeScript (cross-platform)
- **WireGuard**: wireguard-tools, wg-json, или go-wireguard
- **NAT Traversal**: node-stun, или собственная реализация ICE
- **Системные метрики**: systeminformation, os-utils
- **Пакет**: Electron (для GUI) или CLI

---

### 3. HiggsVPN (Клиентское приложение)

#### Назначение
- Подключение к нодам через BosonServer
- Управление WireGuard соединениями
- Мониторинг качества соединения
- Пользовательский интерфейс

#### Структура модулей

```
HiggsVPN
├── Connection Wizard
│   ├── Автоматическое подключение
│   ├── Выбор ноды
│   ├── Настройка параметров
│   └── Quick connect
│
├── Route Optimizer
│   ├── Выбор оптимальной ноды
│   ├── Географический выбор
│   ├── Фильтрация по метрикам
│   └── Кэширование маршрутов
│
├── WireGuard Client
│   ├── WG интерфейс
│   ├── Управление ключами
│   ├── Конфигурация
│   └── Мониторинг соединения
│
├── Quality Monitor
│   ├── Real-time метрики
│   ├── Адаптивное качество
│   ├── Автоматическое переключение
│   └── Уведомления пользователя
│
└── UI Components
    ├── Dashboard
    ├── Node selection
    ├── Settings
    └── Statistics
```

#### Технологии
- **Desktop**: Electron + React/Vue
- **Mobile**: React Native или Flutter
- **WireGuard**: wireguard-tools, wg-json
- **UI Framework**: React, Vue, или нативный

---

## Протоколы и API

### 1. Протокол регистрации ноды

#### Регистрация
```typescript
POST /api/v1/nodes/register
Content-Type: application/json

{
  "nodeId": "string (UUID)",
  "publicKey": "string (WireGuard public key)",
  "networkInfo": {
    "ipv4": "string",
    "ipv6": "string | null",
    "natType": "FullCone | RestrictedCone | PortRestricted | Symmetric",
    "stunMappedAddress": "string | null",
    "localPort": "number (WireGuard port)"
  },
  "capabilities": {
    "maxConnections": "number",
    "bandwidth": {
      "up": "number (Mbps)",
      "down": "number (Mbps)"
    },
    "routing": "boolean",
    "natting": "boolean"
  },
  "metrics": {
    "latency": "number (ms)",
    "jitter": "number (ms)",
    "packetLoss": "number (%)",
    "cpuUsage": "number (%)",
    "memoryUsage": "number (%)"
  },
  "location": {
    "country": "string",
    "region": "string",
    "coordinates": "[number, number] | null"
  },
  "heartbeatInterval": "number (seconds)"
}

Response: {
  "nodeId": "string",
  "status": "registered",
  "relayServers": [
    {
      "id": "string",
      "host": "string",
      "port": "number",
      "protocol": "tcp | udp | websocket"
    }
  ],
  "stunServers": [
    {
      "host": "string",
      "port": "number"
    }
  ],
  "sessionToken": "string (JWT)",
  "expiresAt": "number (timestamp)"
}
```

#### Heartbeat
```typescript
POST /api/v1/nodes/:nodeId/heartbeat
Authorization: Bearer <sessionToken>
Content-Type: application/json

{
  "metrics": {
    "latency": "number",
    "jitter": "number",
    "packetLoss": "number",
    "cpuUsage": "number",
    "memoryUsage": "number",
    "activeConnections": "number",
    "bandwidth": {
      "up": "number",
      "down": "number"
    }
  },
  "status": "online | degraded | offline"
}

Response: {
  "status": "ok",
  "nextHeartbeat": "number (seconds)",
  "actions": [
    {
      "type": "updateConfig | restart | maintenance",
      "payload": "object"
    }
  ]
}
```

---

### 2. Протокол маршрутизации

#### Запрос маршрута
```typescript
POST /api/v1/routing/request
Content-Type: application/json

{
  "clientId": "string (UUID)",
  "targetNodeId": "string | null",
  "requirements": {
    "minBandwidth": "number (Mbps) | null",
    "maxLatency": "number (ms) | null",
    "preferredLocation": "string | null",
    "preferredCountry": "string | null"
  },
  "clientNetworkInfo": {
    "ipv4": "string",
    "natType": "string",
    "stunMappedAddress": "string | null"
  }
}

Response: {
  "routes": [
    {
      "id": "string",
      "type": "direct | relay | cascade",
      "path": ["string (nodeIds)"],
      "estimatedLatency": "number (ms)",
      "estimatedBandwidth": "number (Mbps)",
      "cost": "number",
      "priority": "number"
    }
  ],
  "selectedRoute": {
    "id": "string",
    "relayEndpoint": "string (WebSocket URL)",
    "nodeEndpoint": {
      "nodeId": "string",
      "wireguardConfig": "object",
      "directConnection": "boolean"
    },
    "sessionToken": "string",
    "expiresAt": "number"
  }
}
```

---

### 3. Протокол туннелирования

#### Relay соединение (WebSocket)
```
WebSocket: wss://boson-server/relay/:sessionId

Протокол сообщений:
{
  "type": "data | control | heartbeat",
  "sessionId": "string",
  "direction": "client-to-node | node-to-client",
  "payload": "Buffer | object"
}

Типы сообщений:
- data: WireGuard пакеты
- control: управление соединением (connect, disconnect, error)
- heartbeat: поддержание соединения
```

---

### 4. Протокол метрик

#### Отправка метрик
```typescript
POST /api/v1/metrics
Authorization: Bearer <token>
Content-Type: application/json

{
  "nodeId": "string",
  "timestamp": "number",
  "metrics": {
    "network": {
      "latency": "number",
      "jitter": "number",
      "packetLoss": "number",
      "bandwidth": {
        "up": "number",
        "down": "number"
      }
    },
    "system": {
      "cpuUsage": "number",
      "memoryUsage": "number",
      "diskUsage": "number",
      "loadAverage": "number"
    },
    "wireguard": {
      "packets": {
        "sent": "number",
        "received": "number",
        "errors": "number"
      },
      "bytes": {
        "sent": "number",
        "received": "number"
      }
    },
    "connections": {
      "active": "number",
      "total": "number",
      "failed": "number"
    }
  }
}
```

---

## NAT Traversal стратегия

### Многоуровневая стратегия соединения

```
Приоритет 1: Прямое P2P соединение
├── STUN discovery внешнего адреса
├── UDP Hole Punching (если NAT поддерживает)
└── Прямое WireGuard соединение

Приоритет 2: Relay через ближайший BosonServer
├── Определение ближайшего сервера
├── WebSocket туннель через BosonServer
└── WireGuard через relay

Приоритет 3: Каскадный relay
├── Через несколько серверов
└── Используется только при недоступности прямого пути
```

### Типы NAT и стратегии

| Тип NAT | Стратегия |
|---------|-----------|
| Full Cone | Прямое соединение, UDP Hole Punching |
| Restricted Cone | UDP Hole Punching с предварительным пингом |
| Port Restricted | UDP Hole Punching с множественными попытками |
| Symmetric | Relay через BosonServer (TURN) |

### ICE (Interactive Connectivity Establishment)

```
Процесс ICE:
1. Сбор кандидатов (host, server-reflexive, relayed)
2. Проверка связности (connectivity checks)
3. Выбор оптимальной пары кандидатов
4. Установление соединения
5. Мониторинг и переключение при необходимости
```

---

## Безопасность

### Многоуровневая защита

#### 1. Аутентификация
- **Ноды**: Сертификаты или ключевые пары
- **Клиенты**: Username/Password + 2FA или сертификаты
- **Сессии**: JWT токены с коротким временем жизни

#### 2. Шифрование
- **Transport**: TLS 1.3 для всех API соединений
- **Tunnel**: WireGuard (ChaCha20Poly1305)
- **End-to-End**: Дополнительный слой AES-256-GCM (опционально)

#### 3. Авторизация
- RBAC (Role-Based Access Control)
- Rate limiting на уровне API и нод
- IP whitelisting для нод (опционально)

#### 4. Аудит и логирование
- Логирование всех соединений
- Аудит действий администраторов
- Мониторинг подозрительной активности

---

## Производительность и оптимизация

### Адаптивное качество передачи

```typescript
interface QualityAdaptation {
  // Мониторинг в реальном времени
  currentMetrics: {
    latency: number;
    jitter: number;
    packetLoss: number;
    bandwidth: number;
  };
  
  // Адаптация параметров
  adjustments: {
    compressionLevel: 0-9;        // Адаптивное сжатие
    packetSize: number;           // Оптимальный размер пакета
    bufferSize: number;            // Размер буфера
    codec?: string;                // Выбор кодека (если передача медиа)
  };
  
  // Автоматическое переключение маршрута
  routeSwitch?: {
    reason: 'highLatency' | 'packetLoss' | 'lowBandwidth';
    newRoute: RouteSelection;
  };
}
```

### Оптимизации

1. **Сжатие данных**: Адаптивное сжатие на основе типа трафика
2. **Размер пакетов**: Оптимизация MTU для минимизации фрагментации
3. **Кэширование**: Кэширование маршрутов и метаданных
4. **Приоритизация**: QoS для критичного трафика
5. **Connection pooling**: Переиспользование соединений

---

## Масштабируемость

### Горизонтальное масштабирование

#### BosonServer кластер
```
┌─────────────┐
│ Load Balancer│
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
┌──▼──┐ ┌──▼──┐
│Server│ │Server│
│  1   │ │  2   │
└──┬──┘ └──┬──┘
   │       │
└───┴───────┘
    │
┌───▼────┐
│Database│
│Cluster │
└────────┘
```

#### Географическое распределение
- Серверы в разных регионах
- Автоматический выбор ближайшего сервера
- Репликация метаданных между регионами

### Вертикальное масштабирование
- Мониторинг ресурсов серверов
- Автоматическое масштабирование (Kubernetes HPA)
- Graceful degradation при перегрузке

---

## Мониторинг и аналитика

### Метрики системы

#### BosonServer
- Количество активных нод
- Количество активных соединений
- Пропускная способность relay
- Latency между компонентами
- Ошибки и исключения

#### HiggsNode
- Сетевые метрики (latency, jitter, bandwidth)
- Системные метрики (CPU, RAM, disk)
- Количество активных клиентов
- Ошибки WireGuard

#### HiggsVPN
- Качество соединения
- Скорость передачи данных
- Частота переподключений

### Инструменты
- **Метрики**: Prometheus
- **Визуализация**: Grafana
- **Логи**: ELK Stack или Loki
- **Трейсинг**: Jaeger или Zipkin
- **Алертинг**: Alertmanager

---

## Отказоустойчивость

### Стратегии

1. **Автоматический failover**
   - Резервные BosonServer серверы
   - Автоматическое переключение при сбое

2. **Health checks**
   - Периодические проверки нод
   - Автоматическое удаление неактивных нод

3. **Graceful degradation**
   - Снижение качества при перегрузке
   - Ограничение новых соединений

4. **Автоматическое переподключение**
   - Retry логика с экспоненциальной задержкой
   - Сохранение состояния соединения

---

## Развертывание

### Инфраструктура

#### BosonServer
```yaml
# docker-compose.yml или Kubernetes
services:
  - Discovery Service
  - STUN Service
  - TURN/Relay Service
  - Routing Service
  - Metrics Service
  - API Gateway
  - PostgreSQL
  - Redis
  - Prometheus
  - Grafana
```

#### HiggsNode
- Standalone приложение
- Системный сервис (systemd, launchd, Windows Service)
- Минимальные требования к ресурсам

#### HiggsVPN
- Desktop: Electron приложение
- Mobile: Нативное приложение (React Native/Flutter)

---

## Будущие улучшения

### Планируемые функции

1. **Mesh сеть**: Прямые соединения между нодами
2. **DHT для discovery**: Децентрализованное обнаружение нод
3. **Blockchain для метрик**: Прозрачность и стимулирование нод
4. **Machine Learning**: Предсказание оптимальных маршрутов
5. **IPv6 приоритет**: Нативная поддержка IPv6

---

## Глоссарий

- **NAT (Network Address Translation)**: Преобразование сетевых адресов
- **STUN (Session Traversal Utilities for NAT)**: Протокол для определения внешнего IP
- **TURN (Traversal Using Relays around NAT)**: Протокол relay для NAT traversal
- **ICE (Interactive Connectivity Establishment)**: Протокол для выбора оптимального пути
- **Hole Punching**: Техника установления прямого соединения через NAT
- **Relay**: Промежуточный сервер для передачи трафика
- **QoS (Quality of Service)**: Качество обслуживания, приоритизация трафика

---

## Контакты и документация

- **Репозиторий**: [GitHub URL]
- **Документация API**: [API Docs URL]
- **Issue Tracker**: [Issues URL]

---

*Документ обновлен: [дата]*

