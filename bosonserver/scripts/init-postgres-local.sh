#!/bin/bash
set -e

echo "========================================="
echo "Initializing PostgreSQL Database"
echo "========================================="
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Default values
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_DB=${POSTGRES_DB:-bosonserver}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}

echo "Using PostgreSQL user: $POSTGRES_USER"
echo "Database name: $POSTGRES_DB"
echo ""

# Check if PostgreSQL is running
if ! pg_isready -U "$POSTGRES_USER" > /dev/null 2>&1; then
    echo "Starting PostgreSQL service..."
    
    # Try to start PostgreSQL service
    if command -v systemctl > /dev/null 2>&1; then
        sudo systemctl start postgresql || sudo systemctl start postgresql-15 || true
    elif command -v service > /dev/null 2>&1; then
        sudo service postgresql start || sudo service postgresql-15 start || true
    fi
    
    # Wait for PostgreSQL to start
    echo "Waiting for PostgreSQL to start..."
    MAX_WAIT=30
    WAIT_COUNT=0
    until pg_isready -U "$POSTGRES_USER" > /dev/null 2>&1; do
        if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
            echo "Error: PostgreSQL not ready after $MAX_WAIT seconds"
            echo "Please start PostgreSQL manually and try again"
            exit 1
        fi
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done
    echo "✓ PostgreSQL is ready"
fi

# Create database if it doesn't exist
echo "Creating database '$POSTGRES_DB' if it doesn't exist..."

# Try using peer authentication first (works when running as postgres user or with sudo)
if sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" 2>/dev/null | grep -q 1; then
    echo "Database '$POSTGRES_DB' already exists"
elif sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB" 2>/dev/null; then
    echo "✓ Database '$POSTGRES_DB' created using peer authentication"
else
    # Fallback to password authentication
    echo "Trying password authentication..."
    export PGPASSWORD="$POSTGRES_PASSWORD"
    if psql -U "$POSTGRES_USER" -h localhost -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" 2>/dev/null | grep -q 1; then
        echo "Database '$POSTGRES_DB' already exists"
    elif psql -U "$POSTGRES_USER" -h localhost -c "CREATE DATABASE $POSTGRES_DB" 2>/dev/null; then
        echo "✓ Database '$POSTGRES_DB' created using password authentication"
    else
        echo "✗ Error: Failed to create database. Please check PostgreSQL configuration."
        echo "  You may need to set the PostgreSQL password manually:"
        echo "  sudo -u postgres psql -c \"ALTER USER postgres WITH PASSWORD 'your_password';\""
        exit 1
    fi
fi

echo "✓ Database '$POSTGRES_DB' is ready"
echo ""
echo "Database initialization complete!"
echo "Run migrations will be executed when the server starts."
echo ""

