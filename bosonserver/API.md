# BosonServer API Documentation

## Базовый URL

```
http://localhost:3000
```

## Аутентификация

Большинство endpoints требуют JWT токен в заголовке:

```
Authorization: Bearer <token>
```

## Endpoints

### Health Checks

#### GET /health

Общий health check сервера.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": { "status": "healthy", "latency": 5 },
    "redis": { "status": "healthy", "latency": 2 },
    "turn": { "status": "healthy" },
    "relay": { "status": "healthy", "connections": 10 }
  }
}
```

#### GET /health/ready

Readiness probe для Kubernetes.

#### GET /health/live

Liveness probe для Kubernetes.

### Nodes API

#### POST /api/v1/nodes/register

Регистрация новой ноды.

**Request:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "wireguard-public-key-base64",
  "networkInfo": {
    "ipv4": "192.168.1.1",
    "ipv6": null,
    "natType": "FullCone",
    "stunMappedAddress": null,
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
  }
}
```

**Response:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "registered",
  "relayServers": [
    {
      "id": "relay-1",
      "host": "localhost",
      "port": 3000,
      "protocol": "websocket"
    }
  ],
  "stunServers": [
    {
      "host": "localhost",
      "port": 3478
    }
  ],
  "sessionToken": "jwt-token",
  "expiresAt": 1704067200000
}
```

#### POST /api/v1/nodes/:nodeId/heartbeat

Отправка heartbeat от ноды.

**Headers:**
```
Authorization: Bearer <sessionToken>
```

**Request:**
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
  "status": "online"
}
```

**Response:**
```json
{
  "status": "ok",
  "nextHeartbeat": 30,
  "actions": []
}
```

#### GET /api/v1/nodes/:nodeId

Получение информации о ноде.

**Response:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "wireguard-public-key",
  "networkInfo": { ... },
  "capabilities": { ... },
  "location": { ... },
  "status": "online",
  "lastHeartbeat": "2024-01-01T00:00:00.000Z",
  "registeredAt": "2024-01-01T00:00:00.000Z"
}
```

#### GET /api/v1/nodes

Получение списка всех активных нод.

**Response:**
```json
{
  "nodes": [ ... ],
  "count": 10
}
```

#### DELETE /api/v1/nodes/:nodeId

Удаление ноды.

**Headers:**
```
Authorization: Bearer <sessionToken>
```

**Response:** 204 No Content

### Routing API

#### POST /api/v1/routing/request

Запрос маршрута для клиента.

**Request:**
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

**Response:**
```json
{
  "routes": [
    {
      "id": "route-123",
      "type": "relay",
      "path": ["node-id"],
      "estimatedLatency": 100,
      "estimatedBandwidth": 50,
      "cost": 2,
      "priority": 50
    }
  ],
  "selectedRoute": {
    "id": "route-123",
    "relayEndpoint": "wss://localhost:3000/relay/session-id",
    "nodeEndpoint": {
      "nodeId": "node-id",
      "directConnection": false
    },
    "sessionToken": "session-token",
    "expiresAt": 1704067200000
  }
}
```

#### GET /api/v1/routing/route/:routeId

Получение информации о маршруте.

### Metrics API

#### POST /api/v1/metrics

Отправка метрик от ноды.

**Request:**
```json
{
  "nodeId": "550e8400-e29b-41d4-a716-446655440000",
  "metrics": {
    "network": {
      "latency": 50,
      "jitter": 5,
      "packetLoss": 0.1,
      "bandwidth": { "up": 10, "down": 50 }
    },
    "system": {
      "cpuUsage": 30,
      "memoryUsage": 40,
      "diskUsage": 60,
      "loadAverage": 1.5
    },
    "wireguard": {
      "packets": { "sent": 1000, "received": 2000, "errors": 0 },
      "bytes": { "sent": 1000000, "received": 2000000 }
    },
    "connections": {
      "active": 5,
      "total": 100,
      "failed": 2
    }
  }
}
```

#### GET /api/v1/metrics/:nodeId/latest

Получение последних метрик ноды.

#### GET /api/v1/metrics/:nodeId/history

Получение истории метрик.

**Query Parameters:**
- `startTime` - начальное время (ISO 8601)
- `endTime` - конечное время (ISO 8601)
- `interval` - интервал агрегации (minute|hour|day)

#### GET /api/v1/metrics/:nodeId/aggregated

Получение агрегированных метрик.

**Query Parameters:**
- `startTime` - начальное время
- `endTime` - конечное время

#### GET /metrics

Prometheus метрики (формат Prometheus).

### TURN API

#### GET /api/v1/turn/servers

Получение списка TURN серверов.

**Response:**
```json
{
  "servers": [
    {
      "host": "localhost",
      "port": 3478,
      "realm": "bosonserver",
      "username": "timestamp:random",
      "password": "hmac-sha1-password",
      "ttl": 3600
    }
  ]
}
```

#### GET /api/v1/turn/stun

Получение списка STUN серверов.

#### GET /api/v1/turn/ice

Получение ICE серверов (WebRTC формат).

**Response:**
```json
{
  "iceServers": [
    {
      "urls": "stun:localhost:3478"
    },
    {
      "urls": ["turn:localhost:3478", "turns:localhost:3478"],
      "username": "timestamp:random",
      "credential": "hmac-sha1-password"
    }
  ]
}
```

## WebSocket Relay

### Endpoint

```
wss://localhost:3000/relay/:sessionId
```

### Протокол сообщений

#### Data Message (WireGuard пакеты)

Бинарные данные или JSON:
```json
{
  "type": "data",
  "sessionId": "session-id",
  "direction": "client-to-node",
  "payload": "<binary-data>"
}
```

#### Control Message

```json
{
  "type": "control",
  "sessionId": "session-id",
  "direction": "client-to-node",
  "payload": {
    "action": "connect" | "disconnect"
  }
}
```

#### Heartbeat Message

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

## Коды ошибок

- `400` - Bad Request (невалидные данные)
- `401` - Unauthorized (отсутствует или невалидный токен)
- `403` - Forbidden (недостаточно прав)
- `404` - Not Found (ресурс не найден)
- `429` - Too Many Requests (превышен rate limit)
- `500` - Internal Server Error (внутренняя ошибка сервера)
- `503` - Service Unavailable (сервис недоступен)

## Rate Limiting

По умолчанию:
- 100 запросов за 15 минут на IP адрес
- Строгий лимит: 10 запросов в минуту для некоторых endpoints

Лимиты настраиваются через переменные окружения.

