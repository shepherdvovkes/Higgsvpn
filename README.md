# Higgs.net - Децентрализованная VPN Сеть

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)

**Higgs.net** — это децентрализованная VPN-сеть, построенная на пользовательских нодах за NAT. Система обеспечивает безопасное и эффективное соединение между клиентами и нодами через централизованные relay-серверы с публичными IP-адресами.

## 📋 Содержание

- [Архитектура системы](#архитектура-системы)
- [Основные компоненты](#основные-компоненты)
- [Диаграммы системы](#диаграммы-системы)
- [Анализ проблемных мест](#анализ-проблемных-мест)
- [Быстрый старт](#быстрый-старт)
- [Документация](#документация)

---

## Архитектура системы

Система состоит из трех основных компонентов:

1. **BosonServer** — центральный сервер с публичным IP для NAT traversal и маршрутизации
2. **HiggsNode** — нода на ПК пользователя для маршрутизации трафика
3. **HiggsVPN** — клиентское приложение (desktop/mobile)

### Общая схема взаимодействия

```mermaid
graph TB
    subgraph "Клиентская сеть"
        Client[HiggsVPN Client]
    end
    
    subgraph "Интернет"
        Server[BosonServer<br/>Relay & Discovery]
    end
    
    subgraph "Сеть ноды"
        Node[HiggsNode<br/>VPN Router]
        Router[Home Router<br/>NAT]
    end
    
    subgraph "Интернет"
        Internet[Internet Resources]
    end
    
    Client -->|1. Request Route| Server
    Server -->|2. Route Info| Client
    Client -->|3. WebSocket Relay| Server
    Server -->|4. WebSocket Relay| Node
    Node -->|5. NAT Forwarding| Router
    Router -->|6. Internet Traffic| Internet
    Internet -->|7. Response| Router
    Router -->|8. Response| Node
    Node -->|9. WireGuard| Server
    Server -->|10. WireGuard| Client
```

---

## Основные компоненты

### BosonServer

Центральный сервер, обеспечивающий:
- Регистрацию и обнаружение нод
- NAT traversal через STUN/TURN
- Relay трафика между клиентами и нодами
- Маршрутизацию и балансировку нагрузки
- Мониторинг и метрики

### HiggsNode

Нода на ПК пользователя, выполняющая:
- Регистрацию на BosonServer
- Открытие локального WireGuard порта
- Маршрутизацию и NAT трафика от клиентов
- Сбор и отправку метрик
- Управление ресурсами ПК

### HiggsVPN

Клиентское приложение для:
- Подключения к нодам через BosonServer
- Управления WireGuard соединениями
- Мониторинга качества соединения
- Пользовательского интерфейса

---

## Диаграммы системы

### 1. Диаграмма компонентов системы

```mermaid
graph TB
    subgraph "BosonServer"
        API[API Gateway]
        Discovery[Discovery Service]
        Relay[Relay Service]
        Routing[Routing Service]
        Metrics[Metrics Service]
        TURN[TURN/STUN Service]
        DB[(PostgreSQL)]
        Cache[(Redis)]
    end
    
    subgraph "HiggsNode"
        NodeService[NodeService]
        WGManager[WireGuard Manager]
        RoutingEngine[Routing Engine]
        NATEngine[NAT Traversal Engine]
        MetricsCollector[Metrics Collector]
        ResourceManager[Resource Manager]
        ConnectionManager[Connection Manager]
    end
    
    subgraph "HiggsVPN Client"
        ClientApp[Client Application]
        WGClient[WireGuard Client]
        RouteOptimizer[Route Optimizer]
    end
    
    ClientApp -->|HTTP/HTTPS| API
    NodeService -->|HTTP/HTTPS| API
    API --> Discovery
    API --> Routing
    API --> Metrics
    Discovery --> DB
    Routing --> Cache
    Metrics --> DB
    Metrics --> Cache
    
    ClientApp -->|WebSocket| Relay
    NodeService -->|WebSocket| Relay
    Relay --> Cache
    
    ClientApp -->|STUN/TURN| TURN
    NodeService -->|STUN/TURN| TURN
    
    ClientApp -->|WireGuard| WGClient
    WGClient -->|WebSocket Relay| Relay
    Relay -->|WebSocket Relay| WGManager
    WGManager --> RoutingEngine
    RoutingEngine --> NATEngine
    NATEngine -->|Internet| ResourceManager
    ResourceManager --> MetricsCollector
    MetricsCollector -->|Metrics| API
```

### 2. Диаграмма последовательности: Регистрация ноды и подключение клиента

```mermaid
sequenceDiagram
    participant Node as HiggsNode
    participant Server as BosonServer
    participant Client as HiggsVPN
    participant STUN as STUN Server
    participant Internet as Internet
    
    Note over Node,Internet: Фаза 1: Регистрация ноды
    Node->>STUN: STUN Binding Request
    STUN-->>Node: Mapped Address
    Node->>Server: POST /api/v1/nodes/register
    Server-->>Node: Session Token, Relay Servers
    
    Note over Node,Internet: Фаза 2: Heartbeat
    loop Каждые 30 секунд
        Node->>Server: POST /api/v1/nodes/:id/heartbeat
        Server-->>Node: Status OK
    end
    
    Note over Node,Internet: Фаза 3: Запрос маршрута клиентом
    Client->>Server: POST /api/v1/routing/request
    Server->>Server: Выбор оптимальной ноды
    Server-->>Client: Route Info, Session ID
    
    Note over Node,Internet: Фаза 4: Установление Relay соединения
    Client->>Server: WebSocket Connect (WSS)
    Server-->>Client: Connection Confirmed
    Node->>Server: WebSocket Connect (WSS)
    Server-->>Node: Connection Confirmed
    
    Note over Node,Internet: Фаза 5: Передача данных
    Client->>Server: WireGuard Packet (WebSocket)
    Server->>Node: WireGuard Packet (WebSocket)
    Node->>Internet: NAT Forwarding
    Internet-->>Node: Response
    Node->>Server: WireGuard Packet (WebSocket)
    Server->>Client: WireGuard Packet (WebSocket)
```

### 3. Диаграмма классов основных компонентов

```mermaid
classDiagram
    class BosonServer {
        -discoveryService: DiscoveryService
        -relayService: RelayService
        -routingService: RoutingService
        +registerNode(nodeData): Node
        +getRoute(clientId, requirements): Route
        +relayPacket(sessionId, packet): void
    }
    
    class DiscoveryService {
        -nodeRegistry: NodeRegistry
        -heartbeatManager: HeartbeatManager
        +registerNode(nodeData): Node
        +updateHeartbeat(nodeId): void
        +getAvailableNodes(): Node[]
    }
    
    class RelayService {
        -sessionManager: SessionManager
        -websocketRelay: WebSocketRelay
        +createSession(nodeId, clientId): Session
        +relayPacket(sessionId, packet): void
        +closeSession(sessionId): void
    }
    
    class RoutingService {
        -routeSelector: RouteSelector
        -loadBalancer: LoadBalancer
        +selectRoute(requirements): Route
        +updateRouteMetrics(routeId, metrics): void
    }
    
    class HiggsNode {
        -nodeService: NodeService
        -wireGuardManager: WireGuardManager
        -routingEngine: RoutingEngine
        -natTraversalEngine: NatTraversalEngine
        +start(): void
        +stop(): void
        +handleClientPacket(packet): void
    }
    
    class NodeService {
        -apiClient: ApiClient
        -connectionManager: ConnectionManager
        +register(): void
        +sendHeartbeat(): void
        +handleRelayPacket(packet): void
    }
    
    class RoutingEngine {
        -wireGuardManager: WireGuardManager
        -physicalInterface: NetworkInterface
        +enableNat(): void
        +disableNat(): void
        +forwardPacket(packet): void
    }
    
    class NatTraversalEngine {
        -stunClient: StunClient
        -portForwardingService: PortForwardingService
        +discoverExternalAddress(): Address
        +attemptHolePunching(remoteAddress): boolean
    }
    
    BosonServer --> DiscoveryService
    BosonServer --> RelayService
    BosonServer --> RoutingService
    DiscoveryService --> NodeRegistry
    RelayService --> SessionManager
    RoutingService --> RouteSelector
    HiggsNode --> NodeService
    HiggsNode --> RoutingEngine
    HiggsNode --> NatTraversalEngine
    NodeService --> ApiClient
    RoutingEngine --> WireGuardManager
```

### 4. Диаграмма развертывания

```mermaid
graph TB
    subgraph "Production Environment"
        subgraph "Load Balancer"
            LB[NGINX/HAProxy]
        end
        
        subgraph "BosonServer Cluster"
            BS1[BosonServer 1<br/>Node.js + Docker]
            BS2[BosonServer 2<br/>Node.js + Docker]
            BS3[BosonServer 3<br/>Node.js + Docker]
        end
        
        subgraph "Database Cluster"
            PG1[(PostgreSQL<br/>Primary)]
            PG2[(PostgreSQL<br/>Replica)]
            REDIS[(Redis<br/>Cluster)]
        end
        
        subgraph "Monitoring"
            PROM[Prometheus]
            GRAF[Grafana]
        end
        
        subgraph "TURN Servers"
            TURN1[coturn Server 1]
            TURN2[coturn Server 2]
        end
    end
    
    subgraph "User Networks"
        NODE1[HiggsNode 1<br/>User PC]
        NODE2[HiggsNode 2<br/>User PC]
        NODE3[HiggsNode N<br/>User PC]
    end
    
    subgraph "Clients"
        CLIENT1[HiggsVPN Client 1]
        CLIENT2[HiggsVPN Client 2]
        CLIENTN[HiggsVPN Client N]
    end
    
    LB --> BS1
    LB --> BS2
    LB --> BS3
    
    BS1 --> PG1
    BS2 --> PG1
    BS3 --> PG1
    PG1 --> PG2
    
    BS1 --> REDIS
    BS2 --> REDIS
    BS3 --> REDIS
    
    BS1 --> PROM
    BS2 --> PROM
    BS3 --> PROM
    PROM --> GRAF
    
    BS1 --> TURN1
    BS2 --> TURN2
    
    NODE1 --> LB
    NODE2 --> LB
    NODE3 --> LB
    
    CLIENT1 --> LB
    CLIENT2 --> LB
    CLIENTN --> LB
```

### 5. Диаграмма потока данных (Data Flow)

```mermaid
flowchart LR
    subgraph "Client Side"
        C1[Client App]
        C2[WireGuard Interface]
        C3[WebSocket Client]
    end
    
    subgraph "BosonServer"
        S1[API Gateway]
        S2[Relay Service]
        S3[Session Manager]
        S4[Routing Service]
    end
    
    subgraph "Node Side"
        N1[WebSocket Client]
        N2[WireGuard Interface]
        N3[Routing Engine]
        N4[NAT Engine]
        N5[Physical Interface]
    end
    
    subgraph "Internet"
        I1[Internet Resources]
    end
    
    C1 -->|1. Request Route| S1
    S1 -->|2. Route Selection| S4
    S4 -->|3. Session Creation| S3
    S3 -->|4. Session Info| C1
    
    C1 -->|5. Connect| C3
    C3 -->|6. WSS Connect| S2
    S2 -->|7. WSS Connect| N1
    
    C2 -->|8. WG Packet| C3
    C3 -->|9. WebSocket| S2
    S2 -->|10. WebSocket| N1
    N1 -->|11. WG Packet| N2
    N2 -->|12. Packet| N3
    N3 -->|13. NAT| N4
    N4 -->|14. Forward| N5
    N5 -->|15. Internet| I1
    
    I1 -->|16. Response| N5
    N5 -->|17. Response| N4
    N4 -->|18. NAT| N3
    N3 -->|19. Packet| N2
    N2 -->|20. WG Packet| N1
    N1 -->|21. WebSocket| S2
    S2 -->|22. WebSocket| C3
    C3 -->|23. WG Packet| C2
```

---

## Анализ проблемных мест

### 🔴 Критические проблемы (Приоритет 1)

#### 1. Неправильная настройка NAT и маршрутизации

**Проблема:**
В текущей реализации NAT настроен неправильно. Правила iptables применяются к неправильному интерфейсу, что приводит к невозможности маршрутизации трафика от клиентов в интернет.

**Текущая реализация:**
```bash
iptables -t nat -A POSTROUTING -o ${wireguardInterface} -j MASQUERADE
```

**Правильная реализация:**
```bash
# Определить физический интерфейс
PHYSICAL_IF=$(ip route | grep default | awk '{print $5}' | head -1)

# NAT от WireGuard к физическому интерфейсу
iptables -t nat -A POSTROUTING -i ${WIREGUARD_IF} -o ${PHYSICAL_IF} -j MASQUERADE

# Разрешить forwarding между интерфейсами
iptables -A FORWARD -i ${WIREGUARD_IF} -o ${PHYSICAL_IF} -j ACCEPT
iptables -A FORWARD -i ${PHYSICAL_IF} -o ${WIREGUARD_IF} -m state --state RELATED,ESTABLISHED -j ACCEPT
```

**Последствия:**
- ❌ Трафик от клиентов не маршрутизируется в интернет
- ❌ Клиенты не могут получить доступ к внешним ресурсам
- ❌ Обратный трафик не возвращается клиентам

**Решение:**
- Исправить направление NAT правил (от WireGuard к физическому интерфейсу)
- Добавить автоматическое определение физического интерфейса
- Добавить проверку правильности настройки при старте

#### 2. Отсутствие механизма перехвата и перенаправления пакетов

**Проблема:**
В текущей реализации отсутствует механизм, который перехватывает пакеты от клиентов через WireGuard интерфейс и перенаправляет их на физический интерфейс.

**Что отсутствует:**
- WireGuard получает пакеты от клиентов, но они не перенаправляются автоматически
- Нет обработчика для пакетов, которые должны идти в интернет
- Нет механизма определения default gateway для физического интерфейса

**Последствия:**
- ❌ Пакеты от клиентов теряются
- ❌ Даже при правильном NAT трафик не выходит в интернет
- ❌ Клиенты не могут получить доступ к внешним ресурсам

**Решение:**
- Добавить packet forwarding handler
- Реализовать route table management
- Добавить автоматическое определение default gateway

#### 3. Проблемы с правами доступа (Root/Administrator)

**Проблема:**
Для работы VPN ноды требуются привилегированные права на всех платформах.

**Последствия:**
- ⚠️ Пользователи должны запускать приложение с правами администратора
- ⚠️ Потенциальные риски безопасности
- ⚠️ Сложность установки и использования

**Решение:**
- Использовать Linux capabilities вместо полного root
- Создать systemd service с ограниченными правами
- Использовать polkit для запроса прав при необходимости
- Для Windows: использовать UAC elevation только при необходимости

### 🟡 Важные проблемы (Приоритет 2)

#### 4. Двойной NAT (Double NAT)

**Проблема:**
Когда HiggsNode находится за NAT роутера, возникает двойное преобразование адресов.

**Последствия:**
- ⚠️ Увеличение latency
- ⚠️ Проблемы с некоторыми протоколами (FTP, SIP, игровые протоколы)
- ⚠️ Сложность отладки сетевых проблем

**Решение:**
- Использовать UPnP/IGD для проброса портов на роутере
- Поддержка NAT-PMP (macOS/iOS)
- Рекомендации пользователю настроить port forwarding вручную
- Использовать TURN relay для обхода NAT

#### 5. Производительность WebSocket Relay

**Проблема:**
Трафик проходит через WebSocket relay, что добавляет overhead и увеличивает latency.

**Накладные расходы:**
- WebSocket overhead: ~14 байт на фрейм
- JSON encoding для control messages
- Base64 encoding для бинарных данных (в текущей реализации)
- Дополнительная задержка через relay сервер

**Последствия:**
- ⚠️ Увеличение latency на 50-200ms
- ⚠️ Снижение пропускной способности на 5-10%
- ⚠️ Дополнительная нагрузка на CPU

**Решение:**
- Использовать бинарные WebSocket фреймы вместо base64
- Реализовать packet batching для уменьшения overhead
- Приоритизировать прямые P2P соединения (UDP Hole Punching)
- Использовать TURN вместо WebSocket для лучшей производительности

#### 6. Проблемы с MTU (Maximum Transmission Unit)

**Проблема:**
При туннелировании через WebSocket происходит фрагментация пакетов из-за неправильного MTU.

**Последствия:**
- ⚠️ Фрагментация пакетов увеличивает latency
- ⚠️ Снижение пропускной способности
- ⚠️ Потенциальные проблемы с некоторыми приложениями

**Решение:**
- Автоматическое определение оптимального MTU (Path MTU Discovery)
- Настройка MTU для WireGuard интерфейса с учетом WebSocket overhead
- Адаптивная настройка MTU на основе метрик

#### 7. Безопасность и приватность

**Проблема:**
HiggsNode видит весь трафик клиентов, включая метаданные.

**Последствия:**
- ⚠️ Потенциальная утечка данных о клиентах
- ⚠️ Возможность логирования трафика
- ⚠️ Юридические риски для владельцев нод

**Решение:**
- Zero-knowledge архитектура - нода не должна видеть содержимое трафика
- End-to-end шифрование - дополнительный слой шифрования поверх WireGuard
- Прозрачная политика - четкое информирование о том, что логируется
- Опциональное логирование - только метаданные, без содержимого

#### 8. Проблемы с DNS

**Проблема:**
В текущей реализации нет явной обработки DNS запросов.

**Последствия:**
- ⚠️ DNS запросы могут идти мимо VPN (DNS leak)
- ⚠️ Проблемы с геоблокировкой контента
- ⚠️ Потенциальные проблемы с безопасностью

**Решение:**
- DNS interception - перехват DNS запросов на ноде
- DNS forwarding - перенаправление на безопасные DNS серверы
- DNS over HTTPS/TLS - использование DoH/DoT
- Настройка DNS в WireGuard конфигурации клиента

### 🟢 Улучшения (Приоритет 3)

#### 9. Конфликты с существующими firewall правилами

**Проблема:**
При добавлении правил iptables/pfctl могут возникнуть конфликты с существующими правилами.

**Решение:**
- Использовать отдельную цепочку iptables для HiggsNode
- Сохранение и восстановление правил перед изменением
- Graceful cleanup - удаление правил при остановке
- Проверка конфликтов перед добавлением правил

#### 10. Проблемы с IPv6

**Проблема:**
Текущая реализация фокусируется на IPv4.

**Решение:**
- Добавить поддержку IPv6 NAT (NAT66 или NPTv6)
- Настроить IPv6 forwarding
- Поддержка dual-stack конфигураций

#### 11. Управление ресурсами и ограничения

**Проблема:**
Нет контроля пропускной способности и ограничений на количество соединений.

**Решение:**
- Traffic shaping с использованием `tc` (Linux)
- Per-client rate limiting
- Connection limits на клиента
- QoS правила для приоритизации трафика

#### 12. Проблемы с восстановлением после сбоя

**Проблема:**
При сбое ноды правила iptables и маршруты могут остаться активными.

**Решение:**
- Graceful shutdown - очистка всех правил при остановке
- Signal handlers - обработка SIGTERM, SIGINT для очистки
- Health checks - автоматическое восстановление
- Cleanup scripts - скрипты для очистки при необходимости

---

## Быстрый старт

### Требования

- Node.js 20.x или выше
- Docker и Docker Compose (для BosonServer)
- WireGuard (для HiggsNode и клиентов)
- Права администратора/root (для HiggsNode)

### Установка BosonServer

```bash
cd bosonserver
docker-compose up -d
```

Подробная документация: [bosonserver/README.md](bosonserver/README.md)

### Установка HiggsNode

```bash
cd higgsnode
npm install
npm run build
sudo npm start
```

Подробная документация: [higgsnode/README.md](higgsnode/README.md)

---

## Документация

- [Архитектура системы](ARCHITECTURE.md) - детальное описание архитектуры
- [Протокол передачи данных](PROTOCOL.md) - описание протоколов и API
- [Анализ проблем VPN](VPN_ISSUES_ANALYSIS.md) - детальный анализ проблем
- [Рекомендации по улучшению](IMPROVEMENT_RECOMMENDATIONS_IMPORTANT.md) - рекомендации по решению проблем
- [API документация](bosonserver/API.md) - REST API документация

---

## Статус проекта

⚠️ **Проект в активной разработке**

Текущая версия имеет критические проблемы с маршрутизацией и NAT, которые делают невозможным использование системы в production без исправлений. См. раздел [Анализ проблемных мест](#анализ-проблемных-мест) для деталей.

### План исправлений

1. **Фаза 1 (Критично):** Исправление NAT и маршрутизации
2. **Фаза 2 (Важно):** Оптимизация производительности и безопасности
3. **Фаза 3 (Улучшения):** Дополнительные функции и оптимизации

---

## Лицензия

MIT License - см. [LICENSE](LICENSE) файл для деталей.

---

## Контакты

- **Репозиторий:** [https://github.com/shepherdvovkes/Higgsvpn](https://github.com/shepherdvovkes/Higgsvpn)
- **Issues:** [GitHub Issues](https://github.com/shepherdvovkes/Higgsvpn/issues)

---

*Последнее обновление: Декабрь 2024*

