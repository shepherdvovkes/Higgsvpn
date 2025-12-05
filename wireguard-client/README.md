# WireGuard Client Container

Контейнер с Debian Linux (Debian Bookworm) и установленным WireGuard client.

## Быстрый старт

### 1. Создание конфигурации WireGuard

Создайте файл `config/wg0.conf` с вашей конфигурацией WireGuard:

```ini
[Interface]
PrivateKey = <ваш_приватный_ключ>
Address = 10.0.0.2/24
DNS = 8.8.8.8

[Peer]
PublicKey = <публичный_ключ_сервера>
Endpoint = <ip_сервера>:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

### 2. Запуск контейнера

```bash
docker-compose up -d
```

### 3. Проверка статуса

```bash
# Проверить статус WireGuard внутри контейнера
docker exec wireguard-client wg show

# Проверить логи
docker logs wireguard-client

# Войти в контейнер
docker exec -it wireguard-client bash
```

## Использование без docker-compose

### Сборка образа

```bash
docker build -t wireguard-client .
```

### Запуск контейнера

```bash
docker run -d \
  --name wireguard-client \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_MODULE \
  --device=/dev/net/tun \
  -v $(pwd)/config:/etc/wireguard \
  wireguard-client
```

## Структура директорий

```
wireguard-client/
├── Dockerfile          # Образ контейнера
├── docker-compose.yml  # Конфигурация Docker Compose
├── config/            # Конфигурационные файлы WireGuard (создайте вручную)
│   └── wg0.conf       # Конфигурация интерфейса
└── logs/              # Логи (создаётся автоматически)
```

## Полезные команды

```bash
# Остановка WireGuard
docker exec wireguard-client wg-quick down wg0

# Перезапуск WireGuard
docker exec wireguard-client wg-quick down wg0 && \
docker exec wireguard-client wg-quick up wg0

# Проверка маршрутов
docker exec wireguard-client ip route show

# Проверка IP адресов
docker exec wireguard-client ip addr show
```

## Примечания

- Контейнер требует привилегий `NET_ADMIN` и `SYS_MODULE` для работы с сетью
- Необходим доступ к устройству `/dev/net/tun`
- Конфигурационный файл должен быть смонтирован в `/etc/wireguard/wg0.conf`
- Если конфигурация не найдена, контейнер будет ждать её появления

