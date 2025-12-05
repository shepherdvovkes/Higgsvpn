#!/bin/bash

set -e

# Configuration
BOSONSERVER_URL="${BOSONSERVER_URL:-http://mail.s0me.uk:3003}"
CLIENT_ID="${CLIENT_ID:-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)}"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_CONFIG="/etc/wireguard/${WG_INTERFACE}.conf"
LOG_FILE="/var/log/wireguard-client.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE" >&2
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE" >&2
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE" >&2
}

# Get local IP address
get_local_ip() {
    # Try to get IP from default route interface
    local ip=$(ip route get 8.8.8.8 2>/dev/null | grep -oP 'src \K\S+' | head -1)
    if [ -z "$ip" ]; then
        # Fallback to hostname -I
        ip=$(hostname -I | awk '{print $1}')
    fi
    echo "$ip"
}

# Check if bosonserver is accessible
check_server() {
    log "Checking bosonserver health at $BOSONSERVER_URL"
    local health=$(curl -s -f "${BOSONSERVER_URL}/health" || echo "")
    if [ -z "$health" ]; then
        error "Cannot reach bosonserver at $BOSONSERVER_URL"
    fi
    log "Server is healthy"
}

# Get list of active nodes
get_active_nodes() {
    log "Fetching list of active nodes"
    local response=$(curl -s "${BOSONSERVER_URL}/api/v1/nodes")
    if [ -z "$response" ]; then
        error "Failed to fetch nodes"
    fi
    local nodes=$(echo "$response" | jq -r '.nodes[]? | "\(.nodeId) - \(.location.country // "Unknown")"' 2>/dev/null)
    if [ -z "$nodes" ]; then
        warn "No active nodes available or invalid response"
    fi
    echo "$nodes"
}

# Request route from bosonserver
request_route() {
    local local_ip=$(get_local_ip)
    log "Requesting route from bosonserver (Client ID: $CLIENT_ID, Local IP: $local_ip)" >&2
    
    local response=$(curl -s -X POST "${BOSONSERVER_URL}/api/v1/routing/request" \
        -H "Content-Type: application/json" \
        -d "{
            \"clientId\": \"$CLIENT_ID\",
            \"clientNetworkInfo\": {
                \"ipv4\": \"$local_ip\",
                \"natType\": \"Symmetric\"
            }
        }" 2>&1 | grep -v "^\[" | tail -1)
    
    if [ -z "$response" ]; then
        error "Empty response from server"
    fi
    
    # Check if response is valid JSON
    if ! echo "$response" | jq . > /dev/null 2>&1; then
        error "Invalid JSON response from server: ${response:0:200}"
    fi
    
    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        local error_msg=$(echo "$response" | jq -r '.error // "Unknown error"')
        error "Failed to request route: $error_msg"
    fi
    
    echo "$response"
}

# Generate WireGuard keys
generate_keys() {
    if [ ! -f "/tmp/wg_private.key" ]; then
        log "Generating WireGuard keys" >&2
        wg genkey > /tmp/wg_private.key 2>/dev/null
        wg pubkey < /tmp/wg_private.key > /tmp/wg_public.key 2>/dev/null
        chmod 600 /tmp/wg_private.key /tmp/wg_public.key
    fi
    cat /tmp/wg_private.key
}

# Create WireGuard configuration
create_wg_config() {
    local route_response="$1"
    local private_key=$(generate_keys 2>/dev/null)
    local public_key=$(cat /tmp/wg_public.key 2>/dev/null)
    
    log "Creating WireGuard configuration"
    
    local server_endpoint=$(echo "$route_response" | jq -r '.selectedRoute.wireguardConfig.serverEndpoint // empty' 2>/dev/null)
    local server_public_key=$(echo "$route_response" | jq -r '.selectedRoute.wireguardConfig.serverPublicKey // empty' 2>/dev/null)
    local client_address=$(echo "$route_response" | jq -r '.selectedRoute.wireguardConfig.clientAddress // "10.0.0.2/24"' 2>/dev/null)
    local allowed_ips=$(echo "$route_response" | jq -r '.selectedRoute.wireguardConfig.allowedIPs // "0.0.0.0/0"' 2>/dev/null)
    
    if [ -z "$server_endpoint" ] || [ "$server_endpoint" = "null" ] || [ "$server_endpoint" = "empty" ]; then
        server_endpoint="mail.s0me.uk:51820"
    fi
    
    if [ -z "$server_public_key" ] || [ "$server_public_key" = "null" ] || [ "$server_public_key" = "empty" ] || [ "$server_public_key" = "SERVER_PUBLIC_KEY_PLACEHOLDER" ]; then
        warn "Server public key not provided. WireGuard connection will fail without valid server key."
        warn "Please configure WIREGUARD_SERVER_PUBLIC_KEY environment variable or update bosonserver configuration."
        # Use a dummy key format to allow config creation (will fail at connection, but allows testing)
        server_public_key="00000000000000000000000000000000000000000000="
    fi
    
    # Parse endpoint
    local server_host=$(echo "$server_endpoint" | cut -d: -f1)
    local server_port=$(echo "$server_endpoint" | cut -d: -f2)
    
    log "WireGuard config: Server=$server_host:$server_port, Client=$client_address"
    
    # Set proper permissions before creating config
    umask 077
    
    # Create WireGuard config file
    cat > "$WG_CONFIG" <<EOF
[Interface]
PrivateKey = $private_key
Address = $client_address
DNS = 8.8.8.8, 1.1.1.1

[Peer]
PublicKey = $server_public_key
Endpoint = $server_endpoint
AllowedIPs = $allowed_ips
PersistentKeepalive = 25
EOF
    
    chmod 600 "$WG_CONFIG"
    log "WireGuard configuration created at $WG_CONFIG"
    
    # Return client address for routing setup
    echo "$client_address"
}

# Setup WireGuard interface manually (avoiding sysctl permission issues)
setup_wireguard() {
    log "Setting up WireGuard interface $WG_INTERFACE"
    
    # Check if config exists
    if [ ! -f "$WG_CONFIG" ]; then
        error "WireGuard config file not found: $WG_CONFIG"
    fi
    
    # Bring down interface if it exists
    if ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
        log "Bringing down existing interface $WG_INTERFACE"
        ip link delete "$WG_INTERFACE" 2>/dev/null || true
        sleep 1
    fi
    
    # Extract address for IP assignment (needed separately)
    # Use sed to extract Address from [Interface] section
    local address=$(sed -n '/^\[Interface\]/,/^\[/p' "$WG_CONFIG" | grep -E '^Address\s*=' | head -1 | sed 's/^Address\s*=\s*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    if [ -z "$address" ]; then
        error "Invalid WireGuard configuration: missing Address field in $WG_CONFIG. Config content: $(cat "$WG_CONFIG" | head -10)"
    fi
    
    # Create WireGuard interface
    log "Creating WireGuard interface"
    ip link add "$WG_INTERFACE" type wireguard || error "Failed to create WireGuard interface"
    
    # Configure WireGuard using setconf (reads config file directly, but only [Interface] section)
    # We need to extract just the [Interface] section for setconf
    local temp_interface_config=$(mktemp)
    awk '/^\[Interface\]/,/^\[/{if (/^\[Interface\]/) {print; next} if (/^\[/) {exit} print}' "$WG_CONFIG" > "$temp_interface_config"
    wg setconf "$WG_INTERFACE" "$temp_interface_config" || error "Failed to configure WireGuard interface"
    rm -f "$temp_interface_config"
    
    # Configure peer manually (setconf doesn't handle [Peer] section)
    # Use sed to extract peer configuration from [Peer] section
    local peer_public_key=$(sed -n '/^\[Peer\]/,/^\[/p' "$WG_CONFIG" | grep -E '^PublicKey\s*=' | head -1 | sed 's/^PublicKey\s*=\s*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    local endpoint=$(sed -n '/^\[Peer\]/,/^\[/p' "$WG_CONFIG" | grep -E '^Endpoint\s*=' | head -1 | sed 's/^Endpoint\s*=\s*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    local allowed_ips=$(sed -n '/^\[Peer\]/,/^\[/p' "$WG_CONFIG" | grep -E '^AllowedIPs\s*=' | head -1 | sed 's/^AllowedIPs\s*=\s*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    local persistent_keepalive=$(sed -n '/^\[Peer\]/,/^\[/p' "$WG_CONFIG" | grep -E '^PersistentKeepalive\s*=' | head -1 | sed 's/^PersistentKeepalive\s*=\s*//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    if [ -z "$peer_public_key" ] || [ -z "$endpoint" ]; then
        error "Invalid WireGuard configuration: missing peer configuration"
    fi
    
    # Set peer configuration
    if [ -n "$persistent_keepalive" ]; then
        wg set "$WG_INTERFACE" peer "$peer_public_key" endpoint "$endpoint" allowed-ips "$allowed_ips" persistent-keepalive "$persistent_keepalive" || error "Failed to configure peer"
    else
        wg set "$WG_INTERFACE" peer "$peer_public_key" endpoint "$endpoint" allowed-ips "$allowed_ips" persistent-keepalive 25 || error "Failed to configure peer"
    fi
    
    # Set IP address
    ip address add "$address" dev "$WG_INTERFACE" || error "Failed to set IP address"
    
    # Set MTU and bring up interface
    ip link set mtu 1420 up dev "$WG_INTERFACE" || error "Failed to bring up interface"
    
    # Configure DNS if provided
    if [ -n "$dns" ]; then
        log "Configuring DNS: $dns"
        # DNS will be handled by resolvconf or manually if needed
    fi
    
    # Wait for interface to be ready
    sleep 2
    
    # Show status
    log "WireGuard interface status:"
    wg show "$WG_INTERFACE" 2>/dev/null || warn "Could not show WireGuard status"
    
    # Get interface IP
    local wg_ip=$(ip addr show "$WG_INTERFACE" 2>/dev/null | grep -oP 'inet \K[\d.]+/[\d]+' | head -1)
    if [ -z "$wg_ip" ]; then
        error "Failed to get WireGuard interface IP address"
    fi
    log "WireGuard interface IP: $wg_ip"
    
    echo "$wg_ip"
}

# Setup routing - set default route through WireGuard interface
setup_routing() {
    local wg_ip="$1"
    log "Setting up routing through WireGuard interface"
    
    # Wait a moment for interface to be fully up
    sleep 1
    
    # Check if interface exists
    if ! ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
        error "WireGuard interface $WG_INTERFACE does not exist"
    fi
    
    # Remove existing default route if exists
    if ip route | grep -q "^default"; then
        log "Removing existing default route"
        ip route del default 2>/dev/null || true
    fi
    
    # Add default route through WireGuard interface
    log "Adding default route through $WG_INTERFACE"
    if ! ip route add default dev "$WG_INTERFACE"; then
        error "Failed to add default route"
    fi
    
    # Show routing table
    log "Current routing table:"
    ip route show
    
    # Verify default route
    local default_route=$(ip route | grep "^default")
    if echo "$default_route" | grep -q "$WG_INTERFACE"; then
        log "Default route successfully set through $WG_INTERFACE"
        log "Default route: $default_route"
    else
        error "Failed to verify default route through WireGuard interface"
    fi
}

# Register client with WireGuard server
register_client() {
    local route_response="$1"
    local local_ip=$(get_local_ip)
    local wg_port=$(wg show "$WG_INTERFACE" listen-port 2>/dev/null || echo "51820")
    
    log "Registering WireGuard client with bosonserver"
    
    local node_id=$(echo "$route_response" | jq -r '.selectedRoute.nodeEndpoint.nodeId')
    local session_id=$(echo "$route_response" | jq -r '.selectedRoute.sessionToken')
    
    # Register client for WireGuard UDP connections
    local register_response=$(curl -s -X POST "${BOSONSERVER_URL}/api/v1/wireguard/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"clientId\": \"$CLIENT_ID\",
            \"nodeId\": \"$node_id\",
            \"sessionId\": \"$session_id\",
            \"clientAddress\": \"$local_ip\",
            \"clientPort\": $wg_port
        }")
    
    if echo "$register_response" | jq -e '.status' > /dev/null 2>&1; then
        log "Client registered successfully"
    else
        warn "Failed to register client: $register_response"
    fi
}

# Main connection flow
main() {
    log "Starting WireGuard client connection to $BOSONSERVER_URL"
    log "Client ID: $CLIENT_ID"
    
    # Check server
    check_server
    
    # Show available nodes
    log "Available nodes:"
    get_active_nodes | while read -r node; do
        log "  - $node"
    done
    
    # Request route
    local route_response=$(request_route)
    
    # Debug: show response (first 500 chars) - but clean it first
    local clean_response=$(echo "$route_response" | grep -v "^\[" | head -1)
    log "Route response received (first 500 chars): ${clean_response:0:500}"
    
    # Try to extract node ID
    local node_id=$(echo "$route_response" | jq -r '.selectedRoute.nodeEndpoint.nodeId // empty' 2>/dev/null)
    if [ -z "$node_id" ] || [ "$node_id" = "null" ] || [ "$node_id" = "empty" ]; then
        # Try alternative path
        node_id=$(echo "$route_response" | jq -r '.selectedRoute.nodeEndpoint.nodeId' 2>/dev/null)
        if [ -z "$node_id" ] || [ "$node_id" = "null" ]; then
            error "Failed to get node ID from route response. Response: ${route_response:0:200}"
        fi
    fi
    log "Route assigned to node: $node_id"
    
    # Create WireGuard config
    local client_address=$(create_wg_config "$route_response")
    
    # Setup WireGuard interface (must be done before routing)
    log "Setting up WireGuard interface..."
    local wg_ip=$(setup_wireguard)
    
    if [ -z "$wg_ip" ]; then
        error "Failed to setup WireGuard interface - no IP address assigned"
    fi
    
    log "WireGuard interface is up with IP: $wg_ip"
    
    # Setup routing (after WireGuard is up)
    log "Setting up routing..."
    setup_routing "$wg_ip"
    
    # Register client
    log "Registering client with bosonserver..."
    register_client "$route_response"
    
    log "Connection established successfully!"
    log "Default route: $(ip route | grep '^default' || echo 'No default route found')"
    log "WireGuard status:"
    wg show "$WG_INTERFACE" 2>/dev/null || warn "Could not show WireGuard status"
    
    # Verify routing one more time
    log "Verifying routing configuration..."
    local default_route=$(ip route | grep '^default')
    if echo "$default_route" | grep -q "$WG_INTERFACE"; then
        log "✓ Default route is correctly set through $WG_INTERFACE"
        log "  Route: $default_route"
    else
        warn "⚠ Default route verification failed"
        log "  Current default route: $default_route"
    fi
    
    # Keep container running
    log "Container is running. All traffic is routed through WireGuard interface $WG_INTERFACE"
    log "Press Ctrl+C to stop."
    tail -f /dev/null
}

# Trap signals for cleanup
trap 'log "Shutting down..."; ip link delete "$WG_INTERFACE" 2>/dev/null || true; exit 0' SIGTERM SIGINT

# Run main function
main "$@"

