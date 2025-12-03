# Security Configuration Guide

## Password Generation

Для генерации безопасных паролей используйте скрипт:

```bash
./scripts/generate-passwords.sh
```

Или вручную через Node.js:

```bash
node -e "const crypto = require('crypto'); console.log('POSTGRES_PASSWORD=' + crypto.randomBytes(32).toString('base64')); console.log('JWT_SECRET=' + crypto.randomBytes(64).toString('base64')); console.log('TURN_STATIC_SECRET=' + crypto.randomBytes(32).toString('base64'));"
```

## Environment Variables

Создайте файл `.env` в корне проекта `bosonserver/`:

```env
POSTGRES_PASSWORD=your_secure_postgres_password_here
REDIS_PASSWORD=your_secure_redis_password_here
JWT_SECRET=your_secure_jwt_secret_here
TURN_STATIC_SECRET=your_secure_turn_secret_here
```

## PostgreSQL Authentication

PostgreSQL настроен на использование MD5-аутентификации через файл `config/pg_hba.conf`:

- Локальные подключения (Unix socket): MD5
- IPv4 подключения: MD5
- IPv6 подключения: MD5

Файл `pg_hba.conf` автоматически копируется в контейнер при сборке образа.

## Docker Compose

При использовании `docker-compose`, пароли можно задать через переменные окружения:

```bash
export POSTGRES_PASSWORD='your_secure_password'
export JWT_SECRET='your_secure_jwt_secret'
docker-compose up -d
```

Или создать файл `.env` в директории `bosonserver/` и docker-compose автоматически подхватит переменные.

## Production Deployment

⚠️ **ВАЖНО**: В production окружении:

1. Используйте сильные пароли (минимум 32 символа)
2. Храните пароли в секретах (Docker secrets, Kubernetes secrets, etc.)
3. Не коммитьте `.env` файлы в репозиторий
4. Регулярно ротируйте пароли
5. Используйте разные пароли для разных окружений

## Default Passwords

По умолчанию используются следующие пароли (измените их в production!):

- `POSTGRES_PASSWORD`: `BosonServer2024!Secure#Pass`
- `JWT_SECRET`: `BosonServer2024!JWT#Secret$Key%Very&Long*Secure`
- `TURN_STATIC_SECRET`: `BosonServer2024!TURN#Secret$Key`

Эти пароли должны быть изменены перед развертыванием в production!

