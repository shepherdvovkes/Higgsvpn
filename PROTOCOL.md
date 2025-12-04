# Протокол передачи данных между серверами Higgs.net

## Обзор архитектуры

Система состоит из трех основных компонентов:

1. **BosonServer** - центральный сервер с публичным IP-адресом
2. **HiggsNode** - нода на ПК пользователя (за NAT)
3. **HiggsVPN** - клиентское приложение

## Схема взаимодействия

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  HiggsVPN   │◄───────►│ BosonServer  │◄───────►│ HiggsNode   │
│  (Client)   │         │  (Relay)     │         │  (Node)     │
└─────────────┘         └──────────────┘         └─────────────┘
      │                        │                        │
      │                        │                        │
      └────────────────────────┴────────────────────────┘
                    WireGuard Tunnel
              (через WebSocket Relay)
```

## Протоколы передачи данных

### 1. REST API протокол (HTTP/HTTPS)

Используется для управления и координации между компонентами.

#### 1.1. Регистрация ноды (HiggsNode → BosonServer)

**Endpoint:** `POST /api/v1/nodes/register`

**Протокол:** HTTPS (TLS 1.3)

**Формат запроса:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "wireguard-public-key-base64",
  "networkInfo": {
    "ipv4": "192.168.1.1",
    "ipv6": null,
    "natType": "FullCone | RestrictedCone | PortRestricted | Symmetric",
    "stunMappedAddress": "203.0.113.1:51820",
    "localPort": 51820
  },
  "capabilities": {
    "maxConnections": 100,
    "bandwidth": {
      "up": 100,
      "down": 100
    },
    "routing": true,
    "natting": true
  },
  "location": {
    "country": "US",
    "region": "US-CA",
    "coordinates": [37.7749, -122.4194]
  },
  "metrics": {
    "latency": 50,
    "jitter": 5,
    "packetLoss": 0.1,
    "cpuUsage": 30,
    "memoryUsage": 40
  },
  "heartbeatInterval": 30
}
```

**Формат ответа:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "registered",
  "relayServers": [
    {
      "id": "relay-1",
      "host": "boson.example.com",
      "port": 3000,
      "protocol": "websocket"
    }
  ],
  "stunServers": [
    {
      "host": "stun.boson.example.com",
      "port": 3478
    }
  ],
  "sessionToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": 1704067200000
}
```

**Особенности:**
- Аутентификация не требуется при регистрации
- JWT токен выдается для последующих запросов
- Токен действителен 24 часа
- Ответ содержит конфигурацию relay и STUN серверов

#### 1.2. Heartbeat протокол (HiggsNode → BosonServer)

**Endpoint:** `POST /api/v1/nodes/:nodeId/heartbeat`

**Протокол:** HTTPS (TLS 1.3)

**Аутентификация:** `Authorization: Bearer <sessionToken>`

**Интервал:** 30 секунд (настраивается)

**Формат запроса:**
```json
{
  "metrics": {
    "latency": 50,
    "jitter": 5,
    "packetLoss": 0.1,
    "cpuUsage": 30,
    "memoryUsage": 40,
    "activeConnections": 5,
    "bandwidth": {
      "up": 10,
      "down": 50
    }
  },
  "status": "online | degraded | offline"
}
```

**Формат ответа:**
```json
{
  "status": "ok",
  "nextHeartbeat": 30,
  "actions": [
    {
      "type": "updateConfig | restart | maintenance",
      "payload": {}
    }
  ]
}
```

**Особенности:**
- Поддерживает жизнеспособность ноды
- Позволяет серверу отправлять команды ноде
- При отсутствии heartbeat > 90 секунд нода помечается как offline

#### 1.3. Протокол маршрутизации (HiggsVPN → BosonServer)

**Endpoint:** `POST /api/v1/routing/request`

**Протокол:** HTTPS (TLS 1.3)

**Формат запроса:**
```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "targetNodeId": "550e8400-e29b-41d4-a716-446655440000",
  "requirements": {
    "minBandwidth": 10,
    "maxLatency": 100,
    "preferredLocation": "US-CA",
    "preferredCountry": "US"
  },
  "clientNetworkInfo": {
    "ipv4": "192.168.1.2",
    "natType": "Symmetric",
    "stunMappedAddress": null
  }
}
```

**Формат ответа:**
```json
{
  "routes": [
    {
      "id": "route-123",
      "type": "direct | relay | cascade",
      "path": ["node-id-1", "node-id-2"],
      "estimatedLatency": 100,
      "estimatedBandwidth": 50,
      "cost": 2,
      "priority": 50
    }
  ],
  "selectedRoute": {
    "id": "route-123",
    "relayEndpoint": "wss://boson.example.com:3000/relay/session-id",
    "nodeEndpoint": {
      "nodeId": "node-id",
      "wireguardConfig": {},
      "directConnection": false
    },
    "sessionToken": "session-token-uuid",
    "expiresAt": 1704067200000
  }
}
```

**Особенности:**
- Кэширование маршрутов на 5 минут
- Автоматический выбор оптимального маршрута
- Поддержка прямых и relay соединений

#### 1.4. Протокол метрик (HiggsNode → BosonServer)

**Endpoint:** `POST /api/v1/metrics`

**Протокол:** HTTPS (TLS 1.3)

**Аутентификация:** `Authorization: Bearer <sessionToken>`

**Формат запроса:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1704067200000,
  "metrics": {
    "network": {
      "latency": 50,
      "jitter": 5,
      "packetLoss": 0.1,
      "bandwidth": {
        "up": 10,
        "down": 50
      }
    },
    "system": {
      "cpuUsage": 30,
      "memoryUsage": 40,
      "diskUsage": 60,
      "loadAverage": 1.5
    },
    "wireguard": {
      "packets": {
        "sent": 1000,
        "received": 2000,
        "errors": 0
      },
      "bytes": {
        "sent": 1000000,
        "received": 2000000
      }
    },
    "connections": {
      "active": 5,
      "total": 100,
      "failed": 2
    }
  }
}
```

**Особенности:**
- Отправка каждые 60 секунд
- Хранение в PostgreSQL и Redis
- Экспорт в Prometheus

---

### 2. WebSocket Relay протокол

Используется для туннелирования WireGuard трафика между клиентом и нодой через BosonServer.

#### 2.1. Установление соединения

**Endpoint:** `wss://boson.example.com:3000/relay/:sessionId`

**Протокол:** WebSocket Secure (WSS) поверх TLS 1.3

**Процесс:**
1. Клиент получает `sessionId` из ответа маршрутизации
2. Клиент устанавливает WebSocket соединение к `/relay/:sessionId`
3. Сервер проверяет валидность сессии
4. Сервер отправляет подтверждение соединения

**Подтверждение соединения:**
```json
{
  "type": "control",
  "sessionId": "session-id",
  "direction": "server",
  "payload": {
    "action": "connected"
  }
}
```

#### 2.2. Формат сообщений

Все сообщения могут быть в формате JSON или бинарными (для WireGuard пакетов).

**Структура JSON сообщения:**
```typescript
interface RelayMessage {
  type: 'data' | 'control' | 'heartbeat';
  sessionId: string;
  direction: 'client-to-node' | 'node-to-client' | 'server';
  payload: Buffer | any;
}
```

#### 2.3. Типы сообщений

##### Data Message (WireGuard пакеты)

**Направление:** Клиент ↔ Нода

**Формат (JSON):**
```json
{
  "type": "data",
  "sessionId": "session-id",
  "direction": "client-to-node",
  "payload": "<base64-encoded-binary-data>"
}
```

**Формат (Binary):**
- Прямая передача бинарных данных WireGuard пакетов
- Более эффективно, используется по умолчанию

**Особенности:**
- Пакеты пересылаются без изменений
- Поддержка фрагментации больших пакетов
- Автоматическая маршрутизация по `sessionId`

##### Control Message

**Направление:** Клиент ↔ Сервер ↔ Нода

**Формат:**
```json
{
  "type": "control",
  "sessionId": "session-id",
  "direction": "client-to-node",
  "payload": {
    "action": "connect" | "disconnect" | "error",
    "errorCode": "string (optional)",
    "errorMessage": "string (optional)"
  }
}
```

**Действия:**
- `connect` - инициализация соединения
- `disconnect` - закрытие соединения
- `error` - сообщение об ошибке

##### Heartbeat Message

**Направление:** Сервер ↔ Клиент ↔ Нода

**Интервал:** 30 секунд

**Формат:**
```json
{
  "type": "heartbeat",
  "sessionId": "session-id",
  "direction": "server",
  "payload": {
    "timestamp": 1704067200000
  }
}
```

**Особенности:**
- Поддержание соединения активным
- Обнаружение разрывов соединения
- Автоматическое переподключение при отсутствии ответа

#### 2.4. Управление сессиями

**Создание сессии:**
- Сессия создается при запросе маршрута
- Хранится в PostgreSQL и Redis
- TTL: 1 час (настраивается)

**Структура сессии:**
```typescript
interface RelaySession {
  sessionId: string;
  nodeId: string;
  clientId: string;
  routeId: string;
  status: 'active' | 'closed' | 'error';
  createdAt: Date;
  expiresAt: Date;
  relayEndpoint?: string;
}
```

**Очистка:**
- Автоматическая очистка истекших сессий каждые 5 минут
- Закрытие соединений при истечении TTL

---

### 3. STUN/TURN протокол

Используется для NAT traversal и определения внешних IP-адресов.

#### 3.1. STUN протокол

**Endpoint:** `GET /api/v1/turn/stun`

**Протокол:** UDP/TCP (STUN), HTTPS для получения конфигурации

**Получение STUN серверов:**
```json
{
  "servers": [
    {
      "host": "stun.boson.example.com",
      "port": 3478
    }
  ]
}
```

**Процесс:**
1. Клиент/Нода запрашивает список STUN серверов
2. Выполняется STUN binding request
3. Получение внешнего IP и порта (mapped address)
4. Определение типа NAT

**Типы NAT:**
- `FullCone` - прямой доступ возможен
- `RestrictedCone` - требуется предварительный пинг
- `PortRestricted` - требуется множественные попытки
- `Symmetric` - требуется TURN relay

#### 3.2. TURN протокол

**Endpoint:** `GET /api/v1/turn/servers`

**Протокол:** UDP/TCP (TURN), HTTPS для получения конфигурации

**Получение TURN серверов:**
```json
{
  "servers": [
    {
      "host": "turn.boson.example.com",
      "port": 3478,
      "realm": "bosonserver",
      "username": "timestamp:random",
      "password": "hmac-sha1-password",
      "ttl": 3600
    }
  ]
}
```

**Аутентификация:**
- Используется HMAC-SHA1 для генерации пароля
- Формат: `username:timestamp:random`
- TTL токена: 1 час

**ICE серверы (WebRTC формат):**
```json
{
  "iceServers": [
    {
      "urls": "stun:stun.boson.example.com:3478"
    },
    {
      "urls": [
        "turn:turn.boson.example.com:3478",
        "turns:turn.boson.example.com:3478"
      ],
      "username": "timestamp:random",
      "credential": "hmac-sha1-password"
    }
  ]
}
```

**Особенности:**
- Используется coturn сервер
- Поддержка TCP и UDP
- TLS для TURNS (secure TURN)

---

### 4. WireGuard протокол

Используется для зашифрованного туннелирования трафика между клиентом и нодой.

#### 4.1. Конфигурация

**Получение конфигурации:**
- Конфигурация передается в ответе маршрутизации
- Или через отдельный endpoint (если реализовано)

**Структура конфигурации:**
```ini
[Interface]
PrivateKey = <client-private-key>
Address = 10.0.0.2/24
DNS = 8.8.8.8

[Peer]
PublicKey = <node-public-key>
Endpoint = <node-endpoint>:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

#### 4.2. Туннелирование через Relay

**Процесс:**
1. Клиент устанавливает WireGuard интерфейс
2. WireGuard пакеты перехватываются и отправляются через WebSocket Relay
3. BosonServer пересылает пакеты ноде
4. Нода получает пакеты и обрабатывает их через WireGuard

**Направление трафика:**
```
Client → WireGuard → WebSocket Relay → BosonServer → WebSocket Relay → Node → WireGuard → Internet
```

**Обратное направление:**
```
Internet → Node → WireGuard → WebSocket Relay → BosonServer → WebSocket Relay → Client → WireGuard
```

#### 4.3. Прямое соединение (без Relay)

**Условия:**
- Оба узла имеют совместимые типы NAT
- Успешный UDP Hole Punching
- Определен прямой маршрут

**Процесс:**
1. STUN discovery внешних адресов
2. UDP Hole Punching через STUN сервер
3. Прямое WireGuard соединение
4. Fallback на Relay при неудаче

---

## Последовательность взаимодействия

### Сценарий 1: Регистрация ноды и подключение клиента

```
1. HiggsNode → BosonServer: POST /api/v1/nodes/register
   BosonServer → HiggsNode: { sessionToken, relayServers, stunServers }

2. HiggsNode → BosonServer: POST /api/v1/nodes/:nodeId/heartbeat (каждые 30 сек)

3. HiggsVPN → BosonServer: POST /api/v1/routing/request
   BosonServer → HiggsVPN: { relayEndpoint, sessionToken, nodeEndpoint }

4. HiggsVPN → BosonServer: WebSocket connect wss://.../relay/:sessionId
   BosonServer → HiggsVPN: { type: "control", action: "connected" }

5. HiggsNode → BosonServer: WebSocket connect wss://.../relay/:sessionId
   BosonServer → HiggsNode: { type: "control", action: "connected" }

6. HiggsVPN ↔ BosonServer ↔ HiggsNode: WireGuard пакеты через WebSocket
```

### Сценарий 2: NAT Traversal с прямым соединением

```
1. HiggsNode → STUN Server: STUN Binding Request
   STUN Server → HiggsNode: Mapped Address (external IP:port)

2. HiggsVPN → STUN Server: STUN Binding Request
   STUN Server → HiggsVPN: Mapped Address (external IP:port)

3. HiggsVPN → BosonServer: POST /api/v1/routing/request
   (включает stunMappedAddress)
   BosonServer → HiggsVPN: { directConnection: true, nodeEndpoint }

4. HiggsVPN ↔ HiggsNode: Прямое WireGuard соединение
   (UDP Hole Punching через STUN координацию)
```

### Сценарий 3: Relay через TURN

```
1. HiggsNode → BosonServer: GET /api/v1/turn/ice
   BosonServer → HiggsNode: { iceServers }

2. HiggsNode → TURN Server: TURN Allocation Request
   TURN Server → HiggsNode: Relay Address

3. HiggsVPN → BosonServer: POST /api/v1/routing/request
   BosonServer → HiggsVPN: { relayEndpoint, turnConfig }

4. HiggsVPN ↔ TURN Server ↔ HiggsNode: WireGuard через TURN relay
```

---

## Безопасность

### Шифрование

1. **Transport Layer:**
   - TLS 1.3 для всех HTTPS соединений
   - WSS (WebSocket Secure) для relay

2. **Tunnel Layer:**
   - WireGuard (ChaCha20Poly1305) для всех данных
   - Perfect Forward Secrecy

3. **Аутентификация:**
   - JWT токены для нод (HMAC-SHA256)
   - TURN credentials (HMAC-SHA1)
   - WireGuard ключи (Curve25519)

### Защита от атак

- Rate limiting на всех API endpoints
- Валидация всех входящих данных (Zod schemas)
- Проверка сессий перед relay соединениями
- Автоматическое закрытие истекших сессий
- Логирование всех соединений

---

## Производительность

### Оптимизации

1. **Кэширование:**
   - Маршруты кэшируются в Redis (5 минут)
   - Сессии кэшируются в памяти и Redis
   - Метрики агрегируются перед записью

2. **Сжатие:**
   - WebSocket поддерживает per-message compression
   - WireGuard пакеты не сжимаются (уже зашифрованы)

3. **Connection Pooling:**
   - Переиспользование HTTP соединений
   - WebSocket соединения долгоживущие

4. **Балансировка нагрузки:**
   - Распределение клиентов между нодами
   - Учет метрик при выборе маршрута

---

## Мониторинг и диагностика

### Метрики

- Количество активных сессий
- Пропускная способность relay
- Latency между компонентами
- Количество ошибок и переподключений

### Логирование

- Все API запросы логируются
- WebSocket соединения отслеживаются
- Ошибки записываются с контекстом

### Prometheus экспорт

- Endpoint: `GET /metrics`
- Формат: Prometheus text format
- Метрики: активные ноды, соединения, latency

---

## Обработка ошибок

### Типы ошибок

1. **Сетевые ошибки:**
   - Автоматическое переподключение с экспоненциальной задержкой
   - Fallback на альтернативные маршруты

2. **Ошибки аутентификации:**
   - Обновление токенов
   - Повторная регистрация ноды

3. **Ошибки сессий:**
   - Создание новой сессии
   - Уведомление клиента о необходимости переподключения

### Коды ошибок WebSocket

- `1008` - Invalid session
- `1011` - Internal server error
- `1000` - Normal closure

---

## Расширяемость

### Будущие улучшения

1. **Mesh сеть:**
   - Прямые соединения между нодами
   - Децентрализованное обнаружение

2. **DHT для discovery:**
   - Уменьшение зависимости от центрального сервера
   - Распределенное хранение метаданных

3. **Machine Learning:**
   - Предсказание оптимальных маршрутов
   - Адаптивная балансировка нагрузки

4. **IPv6 приоритет:**
   - Нативная поддержка IPv6
   - Упрощение NAT traversal

---

## Глоссарий

- **NAT (Network Address Translation)** - преобразование сетевых адресов
- **STUN (Session Traversal Utilities for NAT)** - протокол для определения внешнего IP
- **TURN (Traversal Using Relays around NAT)** - протокол relay для NAT traversal
- **ICE (Interactive Connectivity Establishment)** - протокол для выбора оптимального пути
- **Hole Punching** - техника установления прямого соединения через NAT
- **Relay** - промежуточный сервер для передачи трафика
- **Session** - активное соединение между клиентом и нодой
- **Route** - выбранный путь передачи данных

---

*Документ обновлен: 2024*

