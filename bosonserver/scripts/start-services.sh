#!/bin/bash
set -e

echo "Starting BosonServer services..."

# Initialize PostgreSQL data directory if it doesn't exist
PG_DATA="/var/lib/postgresql/data"
if [ ! -d "$PG_DATA" ] || [ ! -f "$PG_DATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL data directory..."
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres "$PG_DATA"
  chmod 700 "$PG_DATA"
  
  # Get password from environment for initdb
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  echo "Using POSTGRES_PASSWORD from environment (length: ${#POSTGRES_PASSWORD})"
  
  # Create temporary password file for initdb
  PWFILE="/tmp/postgres_password.txt"
  echo "$POSTGRES_PASSWORD" > "$PWFILE"
  chmod 600 "$PWFILE"
  chown postgres:postgres "$PWFILE"
  
  # Initialize PostgreSQL database with password file
  echo "Initializing PostgreSQL with password from POSTGRES_PASSWORD..."
  su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D $PG_DATA --pwfile=$PWFILE" || {
    echo "Warning: PostgreSQL initdb may have already run"
  }
  
  # Remove password file for security
  rm -f "$PWFILE"
  
  echo "✓ PostgreSQL initialized with password from POSTGRES_PASSWORD"
fi

echo "PostgreSQL data directory ready"

# Start supervisor in background to initialize PostgreSQL
echo "Starting supervisor to initialize services..."
/usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf &
SUPERVISOR_PID=$!

# Wait for PostgreSQL to start and be ready
echo "Waiting for PostgreSQL to start..."
MAX_WAIT=60
WAIT_COUNT=0

until pg_isready -U postgres > /dev/null 2>&1; do
  if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "Error: PostgreSQL not ready after $MAX_WAIT seconds"
    kill $SUPERVISOR_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo "PostgreSQL is ready"

# Wait a bit more for PostgreSQL to fully start
sleep 3

# Setup PostgreSQL authentication
echo "Setting up PostgreSQL authentication..."
/usr/local/bin/setup-postgres.sh || {
  echo "Warning: setup-postgres.sh failed, continuing anyway..."
}

# Wait a bit more after setup
sleep 2

# Initialize PostgreSQL database
echo "Initializing PostgreSQL database..."
/usr/local/bin/init-db.sh || {
  echo "Warning: init-db.sh failed, continuing anyway..."
}

# Supervisor is already running, just wait for it
echo "Services initialized, supervisor is running (PID: $SUPERVISOR_PID)"
wait $SUPERVISOR_PID

