# Multi-stage build for BosonServer
FROM ubuntu:22.04 AS base

# Установка базовых зависимостей
RUN apt-get update && apt-get install -y \
    curl \
    gnupg2 \
    ca-certificates \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Установка Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Установка PostgreSQL 15
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Europe/Moscow
ENV POSTGRES_PASSWORD=postgres
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt jammy-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get install -y postgresql-15 postgresql-contrib-15

# Установка Redis
RUN apt-get update && apt-get install -y redis-server

# Установка coturn
RUN apt-get update && apt-get install -y coturn

# Установка supervisor
RUN apt-get update && apt-get install -y supervisor

# Создание рабочей директории
WORKDIR /app

# Копирование package файлов
COPY package*.json ./
COPY tsconfig.json ./

# Установка всех зависимостей (нужны dev для сборки)
RUN npm ci

# Копирование исходного кода
COPY . .

# Сборка TypeScript
RUN npm run build

# Копирование SQL файлов миграций в dist (после сборки)
RUN mkdir -p /app/dist/database/migrations && \
    cp /app/src/database/migrations/*.sql /app/dist/database/migrations/ 2>/dev/null || \
    (echo "Warning: SQL files not found" && ls -la /app/src/database/migrations/ || true)

# Удаление dev dependencies после сборки (опционально, для уменьшения размера)
RUN npm prune --production

# Создание директорий для данных
RUN mkdir -p /var/lib/postgresql/data \
    && mkdir -p /var/lib/redis \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /var/run/postgresql \
    && chown -R postgres:postgres /var/lib/postgresql \
    && chown -R postgres:postgres /var/run/postgresql \
    && chown -R redis:redis /var/lib/redis

# Копирование конфигурационных файлов
COPY config/turnserver.conf /etc/turnserver.conf
COPY config/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY config/pg_hba.conf /etc/postgresql/15/main/pg_hba.conf
COPY scripts/init-db.sh /usr/local/bin/init-db.sh
COPY scripts/start-services.sh /usr/local/bin/start-services.sh
COPY scripts/setup-postgres.sh /usr/local/bin/setup-postgres.sh
RUN chmod +x /usr/local/bin/init-db.sh \
    && chmod +x /usr/local/bin/start-services.sh \
    && chmod +x /usr/local/bin/setup-postgres.sh

# pg_hba.conf уже скопирован выше

# Открытие портов
EXPOSE 3000 3478 3479 3480 5432 6379

# Запуск через start-services.sh который настроит PostgreSQL перед запуском supervisor
CMD ["/usr/local/bin/start-services.sh"]

