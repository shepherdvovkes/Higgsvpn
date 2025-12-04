# Используем официальный образ Node.js 20
FROM node:20-alpine

# Устанавливаем необходимые пакеты для работы с WireGuard и сетью
RUN apk add --no-cache \
    wireguard-tools \
    iproute2 \
    curl \
    && rm -rf /var/cache/apk/*

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы package.json
COPY package.json ./

# Устанавливаем все зависимости (включая dev для сборки)
RUN npm install

# Копируем исходный код
COPY . .

# Собираем TypeScript код
RUN npm run build

# Удаляем devDependencies после сборки для уменьшения размера образа
RUN npm prune --production

# Создаем пользователя для запуска приложения (не root)
# Пропускаем ошибки если группа/пользователь уже существуют
RUN addgroup -S higgsvpn || true && \
    adduser -S -G higgsvpn higgsvpn || true && \
    chown -R higgsvpn:higgsvpn /app || chown -R $(id -u):$(id -g) /app

# Для WireGuard нужны права root или NET_ADMIN capability
# Оставляем запуск от root, но ограничиваем права через capabilities
# USER higgsvpn

# Открываем порт для WireGuard (если нужен)
# EXPOSE 51821/udp

# Точка входа
CMD ["npm", "start"]

