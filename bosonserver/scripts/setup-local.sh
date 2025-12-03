#!/bin/bash
set -e

echo "========================================="
echo "BosonServer Local Setup Script"
echo "========================================="
echo ""

# Check if running as root (some commands need sudo)
if [ "$EUID" -eq 0 ]; then 
    SUDO=""
else
    SUDO="sudo"
    echo "Note: Some commands will require sudo privileges"
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo "Error: Cannot detect OS"
    exit 1
fi

echo "Detected OS: $OS $VER"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js
echo "Checking Node.js..."
if command_exists node; then
    NODE_VERSION=$(node -v)
    echo "✓ Node.js found: $NODE_VERSION"
    
    # Check version (need >= 20.0.0)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "✗ Node.js version must be >= 20.0.0"
        echo "  Please install Node.js 20 LTS or later"
        exit 1
    fi
else
    echo "✗ Node.js not found"
    echo "  Installing Node.js 20 LTS..."
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
    elif [ "$OS" = "fedora" ] || [ "$OS" = "rhel" ] || [ "$OS" = "centos" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
        $SUDO yum install -y nodejs
    else
        echo "  Please install Node.js 20 LTS manually from https://nodejs.org/"
        exit 1
    fi
fi

# Check npm
echo "Checking npm..."
if command_exists npm; then
    NPM_VERSION=$(npm -v)
    echo "✓ npm found: $NPM_VERSION"
    
    # Check version (need >= 10.0.0)
    NPM_MAJOR=$(echo $NPM_VERSION | cut -d'.' -f1)
    if [ "$NPM_MAJOR" -lt 10 ]; then
        echo "✗ npm version must be >= 10.0.0"
        echo "  Updating npm..."
        $SUDO npm install -g npm@latest
    fi
else
    echo "✗ npm not found"
    exit 1
fi

# Check PostgreSQL
echo "Checking PostgreSQL..."
if command_exists psql; then
    PG_VERSION=$(psql --version | awk '{print $3}')
    echo "✓ PostgreSQL found: $PG_VERSION"
    
    # Check if PostgreSQL 15 or later
    PG_MAJOR=$(echo $PG_VERSION | cut -d'.' -f1)
    if [ "$PG_MAJOR" -lt 15 ]; then
        echo "⚠ PostgreSQL version is < 15, but continuing..."
    fi
else
    echo "✗ PostgreSQL not found"
    echo "  Installing PostgreSQL 15..."
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        $SUDO apt-get update
        $SUDO apt-get install -y curl gnupg2 ca-certificates lsb-release
        
        # Add PostgreSQL repository
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | $SUDO gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | $SUDO tee /etc/apt/sources.list.d/pgdg.list
        
        $SUDO apt-get update
        $SUDO apt-get install -y postgresql-15 postgresql-contrib-15
    elif [ "$OS" = "fedora" ]; then
        $SUDO dnf install -y postgresql15-server postgresql15
        $SUDO postgresql-15-setup --initdb
    elif [ "$OS" = "rhel" ] || [ "$OS" = "centos" ]; then
        $SUDO yum install -y postgresql15-server postgresql15
        $SUDO /usr/pgsql-15/bin/postgresql-15-setup initdb
    else
        echo "  Please install PostgreSQL 15 manually from https://www.postgresql.org/download/"
        exit 1
    fi
    
    echo "✓ PostgreSQL installed"
fi

# Check Redis
echo "Checking Redis..."
if command_exists redis-server; then
    REDIS_VERSION=$(redis-server --version | awk '{print $3}' | cut -d'=' -f2)
    echo "✓ Redis found: $REDIS_VERSION"
else
    echo "✗ Redis not found"
    echo "  Installing Redis..."
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        $SUDO apt-get update
        $SUDO apt-get install -y redis-server
    elif [ "$OS" = "fedora" ] || [ "$OS" = "rhel" ] || [ "$OS" = "centos" ]; then
        $SUDO yum install -y redis
    else
        echo "  Please install Redis manually from https://redis.io/download"
        exit 1
    fi
    
    echo "✓ Redis installed"
fi

# Check coturn
echo "Checking coturn..."
if command_exists turnserver; then
    TURN_VERSION=$(turnserver --version 2>&1 | head -n1 || echo "unknown")
    echo "✓ coturn found: $TURN_VERSION"
else
    echo "✗ coturn not found"
    echo "  Installing coturn..."
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        $SUDO apt-get update
        $SUDO apt-get install -y coturn
    elif [ "$OS" = "fedora" ] || [ "$OS" = "rhel" ] || [ "$OS" = "centos" ]; then
        $SUDO yum install -y coturn
    else
        echo "  Please install coturn manually from https://github.com/coturn/coturn"
        exit 1
    fi
    
    echo "✓ coturn installed"
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
cd "$(dirname "$0")/.."
npm install

echo ""
echo "========================================="
echo "Setup completed successfully!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and configure it:"
echo "   cp .env.example .env"
echo ""
echo "2. Initialize PostgreSQL database:"
echo "   ./scripts/init-postgres-local.sh"
echo ""
echo "3. Build the project:"
echo "   npm run build"
echo ""
echo "4. Start the server:"
echo "   ./scripts/start-local.sh"
echo ""

