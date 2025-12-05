# Контейнер с Debian Linux и WireGuard client
FROM debian:bookworm-slim

# Установка базовых зависимостей и WireGuard
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    wireguard \
    wireguard-tools \
    iptables \
    iproute2 \
    curl \
    wget \
    vim \
    net-tools \
    iputils-ping \
    netcat-openbsd \
    jq \
    uuid-runtime \
    openresolv \
    ca-certificates \
    procps \
    coturn \
    && rm -rf /var/lib/apt/lists/*

# Создание директории для конфигурации WireGuard
RUN mkdir -p /etc/wireguard

# Создание директории для логов
RUN mkdir -p /var/log

# Копирование скрипта подключения
COPY connect.sh /usr/local/bin/connect.sh
RUN chmod +x /usr/local/bin/connect.sh

# Копирование скрипта тестирования подключения
COPY test-connectivity.sh /test-connectivity.sh
RUN chmod +x /test-connectivity.sh

# Точка входа
CMD ["/usr/local/bin/connect.sh"]

