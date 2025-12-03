# BosonServer - Local Setup Guide

This guide explains how to build and run BosonServer locally without Docker containers.

## Prerequisites

- **Node.js**: >= 20.0.0
- **npm**: >= 10.0.0
- **PostgreSQL**: >= 15 (recommended)
- **Redis**: Latest stable version
- **coturn**: For TURN/STUN server functionality (optional but recommended)

## Quick Start

### 1. Run Setup Script

The setup script will check and install all required dependencies:

```bash
cd bosonserver
chmod +x scripts/*.sh
./scripts/setup-local.sh
```

This script will:
- Check/install Node.js 20 LTS
- Check/install PostgreSQL 15
- Check/install Redis
- Check/install coturn
- Install npm dependencies

### 2. Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and set your configuration values, especially:
- `POSTGRES_PASSWORD` - PostgreSQL password
- `JWT_SECRET` - Secret key for JWT tokens (use a strong random string)
- `TURN_STATIC_SECRET` - Secret for TURN authentication

### 3. Initialize PostgreSQL Database

```bash
./scripts/init-postgres-local.sh
```

This will:
- Start PostgreSQL service if not running
- Create the `bosonserver` database if it doesn't exist

### 4. Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 5. Start the Server

```bash
./scripts/start-local.sh
```

Or manually:

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The server will:
- Check and start PostgreSQL if needed
- Check and start Redis if needed
- Run database migrations automatically
- Start the API server on port 3000 (or PORT from .env)

## Manual Service Management

### PostgreSQL

```bash
# Start
sudo systemctl start postgresql
# or
sudo systemctl start postgresql-15

# Stop
sudo systemctl stop postgresql

# Status
sudo systemctl status postgresql

# Enable on boot
sudo systemctl enable postgresql
```

### Redis

```bash
# Start
sudo systemctl start redis
# or
sudo systemctl start redis-server

# Stop
sudo systemctl stop redis

# Status
sudo systemctl status redis
```

### coturn (TURN/STUN Server)

```bash
# Start
sudo systemctl start coturn

# Configure
# Edit /etc/turnserver.conf or copy config/turnserver.conf to /etc/turnserver.conf
sudo cp config/turnserver.conf /etc/turnserver.conf

# Update TURN_STATIC_SECRET in .env to match static-auth-secret in turnserver.conf
```

## Development

### Run in Development Mode

```bash
npm run dev
```

This uses `ts-node-dev` for hot-reloading.

### Run Tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage
```

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npm run type-check
```

## Project Structure

```
bosonserver/
├── src/                    # TypeScript source code
│   ├── api/               # API Gateway and routes
│   ├── services/          # Business logic services
│   ├── database/          # Database connections and migrations
│   ├── config/            # Configuration
│   └── utils/             # Utilities
├── dist/                  # Compiled JavaScript (generated)
├── config/                # Configuration files (TURN, supervisor, etc.)
├── scripts/               # Setup and utility scripts
├── tests/                 # Test files
└── package.json           # Dependencies and scripts
```

## Database Migrations

Migrations are automatically run when the server starts. They are located in:
- `src/database/migrations/*.sql` - SQL migration files
- `src/database/migrations/run-migrations.ts` - Migration runner

The migration system tracks applied migrations in the `schema_migrations` table.

## API Endpoints

Once running, the server exposes:

- **Health Check**: `GET http://localhost:3000/health`
- **Readiness**: `GET http://localhost:3000/health/ready`
- **Liveness**: `GET http://localhost:3000/health/live`
- **Metrics**: `GET http://localhost:3000/metrics` (Prometheus format)
- **API**: See `API.md` for full API documentation

## Troubleshooting

### PostgreSQL Connection Issues

1. Check if PostgreSQL is running:
   ```bash
   pg_isready -U postgres
   ```

2. Check PostgreSQL logs:
   ```bash
   sudo journalctl -u postgresql -f
   ```

3. Verify connection settings in `.env`:
   - `POSTGRES_HOST=localhost`
   - `POSTGRES_PORT=5432`
   - `POSTGRES_USER=postgres`
   - `POSTGRES_PASSWORD=...`

### Redis Connection Issues

1. Check if Redis is running:
   ```bash
   redis-cli ping
   ```

2. Check Redis logs:
   ```bash
   sudo journalctl -u redis -f
   ```

3. Verify connection settings in `.env`:
   - `REDIS_HOST=localhost`
   - `REDIS_PORT=6379`

### Port Already in Use

If port 3000 is already in use, change it in `.env`:
```
PORT=3001
```

### Build Errors

1. Clean and rebuild:
   ```bash
   rm -rf dist node_modules
   npm install
   npm run build
   ```

2. Check TypeScript errors:
   ```bash
   npm run type-check
   ```

### Migration Errors

If migrations fail, you can manually check the database:
```bash
psql -U postgres -d bosonserver -c "SELECT * FROM schema_migrations;"
```

## Production Considerations

For production deployment:

1. **Use strong secrets**: Generate random strings for `JWT_SECRET` and `TURN_STATIC_SECRET`
2. **Configure firewall**: Only expose necessary ports
3. **Use TLS**: Configure HTTPS for the API
4. **Set up monitoring**: Use Prometheus metrics endpoint
5. **Configure logging**: Set appropriate `LOG_LEVEL`
6. **Database backups**: Set up regular PostgreSQL backups
7. **Process management**: Consider using PM2 or systemd for process management

## Additional Resources

- [API Documentation](API.md)
- [Security Guide](README_SECURITY.md)
- [Architecture Overview](../ARCHITECTURE.md)

