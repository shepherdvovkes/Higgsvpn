#!/bin/bash
set -e

echo "========================================="
echo "Starting BosonServer (Local)"
echo "========================================="
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Warning: .env file not found. Using defaults."
fi

# Default values
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_DB=${POSTGRES_DB:-bosonserver}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
REDIS_HOST=${REDIS_HOST:-localhost}
REDIS_PORT=${REDIS_PORT:-6379}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if service is running
check_service() {
    local service_name=$1
    local check_cmd=$2
    
    if eval "$check_cmd" > /dev/null 2>&1; then
        echo "✓ $service_name is running"
        return 0
    else
        echo "✗ $service_name is not running"
        return 1
    fi
}

# Check PostgreSQL
echo "Checking PostgreSQL..."
if ! check_service "PostgreSQL" "pg_isready -U $POSTGRES_USER"; then
    echo "Starting PostgreSQL..."
    if command -v systemctl > /dev/null 2>&1; then
        sudo systemctl start postgresql || sudo systemctl start postgresql-15 || true
    elif command -v service > /dev/null 2>&1; then
        sudo service postgresql start || sudo service postgresql-15 start || true
    fi
    
    # Wait for PostgreSQL
    MAX_WAIT=30
    WAIT_COUNT=0
    until pg_isready -U "$POSTGRES_USER" > /dev/null 2>&1; do
        if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
            echo "Error: PostgreSQL not ready after $MAX_WAIT seconds"
            exit 1
        fi
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done
    echo "✓ PostgreSQL is ready"
fi

# Check Redis
echo "Checking Redis..."
if ! check_service "Redis" "redis-cli -h $REDIS_HOST -p $REDIS_PORT ping"; then
    echo "Starting Redis..."
    if command -v systemctl > /dev/null 2>&1; then
        sudo systemctl start redis || sudo systemctl start redis-server || true
    elif command -v service > /dev/null 2>&1; then
        sudo service redis start || sudo service redis-server start || true
    else
        # Try to start Redis manually
        redis-server --daemonize yes || true
    fi
    
    # Wait for Redis
    MAX_WAIT=30
    WAIT_COUNT=0
    until redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; do
        if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
            echo "Error: Redis not ready after $MAX_WAIT seconds"
            exit 1
        fi
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done
    echo "✓ Redis is ready"
fi

# Check coturn (optional, can run without it)
echo "Checking coturn..."
if command_exists turnserver; then
    if ! pgrep -x turnserver > /dev/null; then
        echo "Note: coturn is not running. TURN/STUN features will not work."
        echo "  To start coturn manually: sudo systemctl start coturn"
    else
        echo "✓ coturn is running"
    fi
else
    echo "Note: coturn not found. TURN/STUN features will not work."
fi

# Check if project is built
if [ ! -d "dist" ] || [ ! -f "dist/index.js" ]; then
    echo "Project not built. Building now..."
    npm run build
fi

# Ensure migrations directory exists in dist
mkdir -p dist/database/migrations
cp src/database/migrations/*.sql dist/database/migrations/ 2>/dev/null || true

echo ""
echo "Starting BosonServer..."
echo ""

# Start the server
if [ "$NODE_ENV" = "development" ]; then
    npm run dev
else
    npm start
fi

