#!/bin/bash
set -e

echo "Setting up PostgreSQL authentication..."

# Wait for PostgreSQL data directory to be initialized
PG_DATA="/var/lib/postgresql/data"
MAX_WAIT=30
WAIT_COUNT=0

while [ ! -d "$PG_DATA" ] || [ ! -f "$PG_DATA/PG_VERSION" ]; do
  if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "Error: PostgreSQL data directory not initialized after $MAX_WAIT seconds"
    exit 1
  fi
  echo "Waiting for PostgreSQL data directory to be initialized... ($WAIT_COUNT/$MAX_WAIT)"
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
done

echo "PostgreSQL data directory found"

# Wait for PostgreSQL to be ready and accepting connections
echo "Waiting for PostgreSQL to be ready..."
MAX_WAIT_PG=30
WAIT_COUNT_PG=0
until pg_isready -U postgres > /dev/null 2>&1; do
  if [ $WAIT_COUNT_PG -ge $MAX_WAIT_PG ]; then
    echo "Error: PostgreSQL not ready after $MAX_WAIT_PG seconds"
    exit 1
  fi
  echo "Waiting for PostgreSQL to start... ($WAIT_COUNT_PG/$MAX_WAIT_PG)"
  sleep 1
  WAIT_COUNT_PG=$((WAIT_COUNT_PG + 1))
done

echo "PostgreSQL is ready, waiting additional 2 seconds for socket connections..."
sleep 2

# Get password from environment or use default
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
echo "Using POSTGRES_PASSWORD from environment (length: ${#POSTGRES_PASSWORD})"

# CRITICAL: Ensure pg_hba.conf allows trust BEFORE setting password
PG_HBA_DATA="/var/lib/postgresql/data/pg_hba.conf"
if [ -f "$PG_HBA_DATA" ]; then
  echo "Backing up current pg_hba.conf..."
  cp "$PG_HBA_DATA" "${PG_HBA_DATA}.backup.$(date +%s)" 2>/dev/null || true
  
  # Check if trust is already set (from initdb)
  if grep -q "^local.*all.*all.*trust" "$PG_HBA_DATA"; then
    echo "✓ pg_hba.conf already allows trust for local connections (from initdb)"
  else
    # Switch to trust to ensure we can set password
    echo "Switching to trust authentication for local connections..."
    # Remove any existing local rules
    sed -i '/^local.*all.*all/d' "$PG_HBA_DATA" 2>/dev/null || true
    # Add trust rule at the beginning (before any host rules)
    sed -i '1i local   all             all                                     trust' "$PG_HBA_DATA" 2>/dev/null || true
  fi
  
  # CRITICAL: Reload PostgreSQL configuration to apply trust
  # Note: We use reload instead of restart to avoid supervisor conflicts
  echo "Reloading PostgreSQL configuration to apply trust authentication..."
  
  # Try multiple methods to reload PostgreSQL config
  RELOADED=false
  
  # Method 1: Use supervisorctl if available and working
  if command -v supervisorctl > /dev/null 2>&1; then
    echo "Trying supervisorctl to reload PostgreSQL..."
    if supervisorctl -c /etc/supervisor/conf.d/supervisord.conf signal HUP postgresql 2>&1; then
      echo "✓ PostgreSQL reloaded via supervisorctl"
      RELOADED=true
    elif supervisorctl -c /etc/supervisor/conf.d/supervisord.conf restart postgresql 2>&1; then
      echo "✓ PostgreSQL restarted via supervisorctl"
      RELOADED=true
    else
      echo "Warning: supervisorctl failed, trying alternative methods..."
    fi
  fi
  
  # Method 2: Use pg_ctl reload if supervisorctl didn't work
  if [ "$RELOADED" = false ]; then
    echo "Trying pg_ctl reload..."
    if su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D /var/lib/postgresql/data reload" 2>&1; then
      echo "✓ PostgreSQL reloaded via pg_ctl"
      RELOADED=true
    else
      echo "Warning: pg_ctl reload failed, trying SIGHUP..."
      # Method 3: Send SIGHUP directly
      if pkill -HUP -u postgres postgres 2>/dev/null; then
        echo "✓ PostgreSQL reloaded via SIGHUP"
        RELOADED=true
      else
        echo "⚠ Warning: Could not reload PostgreSQL, but continuing..."
      fi
    fi
  fi
  
  echo "Waiting for PostgreSQL to apply trust configuration..."
  sleep 5
  
  # Verify PostgreSQL is still running and ready
  MAX_WAIT_RELOAD=30
  WAIT_COUNT_RELOAD=0
  until pg_isready -U postgres > /dev/null 2>&1; do
    if [ $WAIT_COUNT_RELOAD -ge $MAX_WAIT_RELOAD ]; then
      echo "Error: PostgreSQL not ready after reload"
      exit 1
    fi
    echo "Waiting for PostgreSQL to be ready after reload... ($WAIT_COUNT_RELOAD/$MAX_WAIT_RELOAD)"
    sleep 1
    WAIT_COUNT_RELOAD=$((WAIT_COUNT_RELOAD + 1))
  done
  echo "✓ PostgreSQL is ready after reload"
  
  # Verify trust is in pg_hba.conf
  if grep -q "^local.*all.*all.*trust" "$PG_HBA_DATA"; then
    echo "✓ Verified: pg_hba.conf has trust authentication for local connections"
  else
    echo "✗ Error: Could not verify trust authentication in pg_hba.conf"
    exit 1
  fi
else
  echo "✗ Error: pg_hba.conf not found, PostgreSQL may not be fully initialized"
  exit 1
fi

# Get password from environment
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
echo "Setting PostgreSQL password from POSTGRES_PASSWORD environment variable..."

# Create SQL script to set password
SQL_SCRIPT="/tmp/set_password.sql"
ESCAPED_PASSWORD=$(echo "$POSTGRES_PASSWORD" | sed "s/'/''/g")
echo "ALTER USER postgres WITH PASSWORD '${ESCAPED_PASSWORD}';" > "$SQL_SCRIPT"
chmod 644 "$SQL_SCRIPT"

# Wait a bit to ensure PostgreSQL is fully ready
sleep 2

# Set password using trust authentication (trust is default after initdb)
# Use su -l postgres which provides proper environment
echo "Executing password setup SQL script..."
if su -l postgres -c "psql -f $SQL_SCRIPT" 2>&1; then
  echo "✓ Password set successfully"
  PASSWORD_SET=true
else
  echo "⚠ Warning: Could not set password, trying alternative method..."
  # Try with explicit database
  if su -l postgres -c "psql -d postgres -f $SQL_SCRIPT" 2>&1; then
    echo "✓ Password set successfully with explicit database"
    PASSWORD_SET=true
  else
    echo "✗ ERROR: Failed to set password"
    PASSWORD_SET=false
  fi
fi

# Clean up SQL script
rm -f "$SQL_SCRIPT"

# Verify password was set by testing connection
if [ "$PASSWORD_SET" = true ]; then
  echo "Verifying password..."
  if PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -h localhost -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✓ Password verified and working"
  else
    echo "⚠ Warning: Password set but verification failed (will try after md5 switch)"
  fi
fi

# Configure pg_hba.conf in data directory
PG_HBA_DATA="/var/lib/postgresql/data/pg_hba.conf"

if [ -d "$PG_DATA" ] && [ -f "$PG_DATA/PG_VERSION" ]; then
  echo "Configuring pg_hba.conf in data directory..."
  
  # Backup existing pg_hba.conf if it exists
  if [ -f "$PG_HBA_DATA" ]; then
    cp "$PG_HBA_DATA" "${PG_HBA_DATA}.backup.$(date +%s)" 2>/dev/null || true
    echo "Backed up existing pg_hba.conf"
  fi
  
  # Create/update pg_hba.conf with md5 authentication
  echo "Creating/updating pg_hba.conf with md5 authentication..."
  cat > "$PG_HBA_DATA" << 'EOF'
# PostgreSQL Client Authentication Configuration File
# Generated by setup-postgres.sh

# "local" is for Unix domain socket connections only
local   all             all                                     md5

# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
host    all             all             0.0.0.0/0                md5

# IPv6 local connections:
host    all             all             ::1/128                 md5
host    all             all             ::/0                    md5

# Allow replication connections from localhost, by a user with the
# replication privilege.
local   replication     all                                     md5
host    replication     all             127.0.0.1/32            md5
host    replication     all             ::1/128                 md5
EOF
  
  # Ensure proper permissions
  chown postgres:postgres "$PG_HBA_DATA" 2>/dev/null || true
  chmod 600 "$PG_HBA_DATA" 2>/dev/null || true
  
  echo "pg_hba.conf created/updated with md5 authentication"
  
  # Reload PostgreSQL configuration
  echo "Reloading PostgreSQL configuration..."
  su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D /var/lib/postgresql/data reload" 2>&1 || {
    echo "Warning: Failed to reload PostgreSQL config, trying SIGHUP..."
    pkill -HUP -u postgres postgres 2>/dev/null || true
  }
  
  # Wait a bit for reload to take effect
  sleep 2
  
  echo "PostgreSQL authentication configured with md5"
else
  echo "Error: PostgreSQL data directory not found or not initialized"
  exit 1
fi

