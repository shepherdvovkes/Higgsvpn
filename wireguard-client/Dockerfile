# Контейнер с Linux и WireGuard client
FROM ubuntu:22.04

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
    && rm -rf /var/lib/apt/lists/*

# Создание директории для конфигурации WireGuard
RUN mkdir -p /etc/wireguard

# Создание скрипта для запуска WireGuard
RUN echo '#!/bin/bash\n\
# Проверка наличия конфигурационного файла\n\
if [ -f /etc/wireguard/wg0.conf ]; then\n\
    echo "Запуск WireGuard с конфигурацией /etc/wireguard/wg0.conf"\n\
    wg-quick up wg0\n\
    echo "WireGuard запущен"\n\
    # Показываем статус\n\
    wg show\n\
    # Держим контейнер запущенным\n\
    tail -f /dev/null\n\
else\n\
    echo "Конфигурационный файл /etc/wireguard/wg0.conf не найден"\n\
    echo "Создайте конфигурацию или смонтируйте её в /etc/wireguard/"\n\
    echo "Пример конфигурации:"\n\
    echo "[Interface]"\n\
    echo "PrivateKey = <ваш_приватный_ключ>"\n\
    echo "Address = 10.0.0.2/24"\n\
    echo ""\n\
    echo "[Peer]"\n\
    echo "PublicKey = <публичный_ключ_сервера>"\n\
    echo "Endpoint = <ip_сервера>:51820"\n\
    echo "AllowedIPs = 0.0.0.0/0"\n\
    tail -f /dev/null\n\
fi' > /usr/local/bin/start-wireguard.sh && \
    chmod +x /usr/local/bin/start-wireguard.sh

# Точка входа
CMD ["/usr/local/bin/start-wireguard.sh"]

