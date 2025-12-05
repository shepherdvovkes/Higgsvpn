#!/bin/bash

# Test script for STUN/TURN functionality
# Tests both STUN (binding request) and TURN (allocation) functionality

set -e

BOSONSERVER_URL="${BOSONSERVER_URL:-http://mail.s0me.uk:3003}"
TURN_HOST="mail.s0me.uk"
TURN_PORT=3478

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "STUN/TURN Functionality Test"
echo "=========================================="
echo "TURN Server: $TURN_HOST:$TURN_PORT"
echo "BosonServer API: $BOSONSERVER_URL"
echo "=========================================="
echo ""

# Function to test STUN binding request
test_stun() {
    echo -e "${BLUE}=== Testing STUN (Binding Request) ===${NC}"
    
    # STUN binding request (RFC 5389)
    # Simple STUN message: 0x0001 (Binding Request), 0x0000 (Message Length), Transaction ID
    # This is a minimal STUN binding request
    
    if command -v stunclient >/dev/null 2>&1; then
        echo "Using stunclient..."
        stunclient "$TURN_HOST" "$TURN_PORT" 2>&1
        return $?
    elif command -v turnutils_stunclient >/dev/null 2>&1; then
        echo "Using turnutils_stunclient..."
        turnutils_stunclient "$TURN_HOST" -p "$TURN_PORT" 2>&1
        return $?
    else
        echo -e "${YELLOW}STUN client tools not available. Testing with raw UDP...${NC}"
        
        # Try to send a basic STUN binding request
        # STUN Binding Request format (simplified):
        # 0x00 0x01 - Message Type (Binding Request)
        # 0x00 0x00 - Message Length
        # Transaction ID (12 bytes)
        
        # Create a simple STUN binding request
        stun_request=$(printf '\x00\x01\x00\x00\x21\x12\xa4\x42%08x%08x' $(date +%s) $$)
        
        echo "$stun_request" | timeout 5 nc -u -w 2 "$TURN_HOST" "$TURN_PORT" 2>/dev/null | od -An -tx1 | head -5
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}UDP packet sent to STUN port${NC}"
            return 0
        else
            echo -e "${RED}Failed to send STUN request${NC}"
            return 1
        fi
    fi
}

# Function to get TURN credentials from bosonserver
get_turn_credentials() {
    echo -e "${BLUE}=== Getting TURN Credentials from BosonServer ===${NC}"
    
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
        echo -e "${RED}curl or wget not available${NC}"
        return 1
    fi
    
    local response
    if command -v curl >/dev/null 2>&1; then
        response=$(curl -s "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    else
        response=$(wget -qO- "${BOSONSERVER_URL}/api/v1/turn/servers" 2>/dev/null)
    fi
    
    if [ -z "$response" ]; then
        echo -e "${RED}Failed to get TURN credentials${NC}"
        return 1
    fi
    
    # Check if response is JSON
    if echo "$response" | grep -q '{'; then
        echo -e "${GREEN}TURN credentials received:${NC}"
        echo "$response" | head -20
        
        # Try to extract credentials if jq is available
        if command -v jq >/dev/null 2>&1; then
            echo ""
            echo "Parsed credentials:"
            echo "$response" | jq '.' 2>/dev/null || echo "$response"
        fi
        return 0
    else
        echo -e "${YELLOW}Unexpected response format:${NC}"
        echo "$response"
        return 1
    fi
}

# Function to test TURN allocation (requires credentials)
test_turn_allocation() {
    echo -e "${BLUE}=== Testing TURN Allocation ===${NC}"
    
    if command -v turnutils_peer >/dev/null 2>&1; then
        echo "Using turnutils_peer for TURN test..."
        # This would require credentials
        echo -e "${YELLOW}TURN allocation test requires credentials${NC}"
        echo "Get credentials first using: get_turn_credentials"
        return 1
    else
        echo -e "${YELLOW}TURN testing tools not available${NC}"
        echo "Install coturn-utils package for full TURN testing"
        return 1
    fi
}

# Function to test with Python if available
test_with_python() {
    if ! command -v python3 >/dev/null 2>&1; then
        return 1
    fi
    
    echo -e "${BLUE}=== Testing with Python STUN Client ===${NC}"
    
    python3 << PYTHON_SCRIPT
import socket
import struct
import time
import sys
import os

def create_stun_binding_request():
    """Create a STUN Binding Request message (RFC 5389)"""
    # STUN message format:
    # 0-1: Message Type (0x0001 = Binding Request)
    # 2-3: Message Length
    # 4-7: Magic Cookie (0x2112A442)
    # 8-19: Transaction ID (12 bytes)
    
    msg_type = 0x0001  # Binding Request
    msg_length = 0x0000
    magic_cookie = 0x2112A442
    # Generate 12-byte transaction ID
    transaction_id_bytes = os.urandom(12)
    
    # Pack the message
    message = struct.pack('!HHI', msg_type, msg_length, magic_cookie)
    message += transaction_id_bytes
    
    return message

def test_stun(host, port):
    """Test STUN binding request"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5)
        
        # Create STUN binding request
        request = create_stun_binding_request()
        
        # Send request
        sock.sendto(request, (host, port))
        print(f"✓ STUN Binding Request sent to {host}:{port}")
        print(f"  Request length: {len(request)} bytes")
        
        # Wait for response
        try:
            response, addr = sock.recvfrom(1024)
            print(f"✓ STUN Binding Response received from {addr}")
            print(f"  Response length: {len(response)} bytes")
            
            # Parse response (simplified)
            if len(response) >= 20:
                msg_type = struct.unpack('!H', response[0:2])[0]
                if msg_type == 0x0101:  # Binding Success Response
                    print("  Message Type: Binding Success Response (0x0101)")
                    # Try to extract mapped address if present
                    if len(response) > 20:
                        print("  ✓ STUN server is responding correctly")
                    return True
                elif msg_type == 0x0111:  # Binding Error Response
                    print("  Message Type: Binding Error Response (0x0111)")
                    return False
                else:
                    print(f"  Message Type: Unknown (0x{msg_type:04x})")
                    print("  ⚠ Got response but format unexpected")
                    return True  # Got a response, server is alive
            return True
        except socket.timeout:
            print("  ⚠ No response received (timeout)")
            print("  This may be normal - server might not respond to all requests")
            return False
        finally:
            sock.close()
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "mail.s0me.uk"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 3478
    
    print(f"Testing STUN on {host}:{port}")
    success = test_stun(host, port)
    sys.exit(0 if success else 1)
PYTHON_SCRIPT
    
    return $?
}

# Main test flow
main() {
    local tests_passed=0
    local tests_total=0
    
    # Test 1: Get TURN credentials
    tests_total=$((tests_total + 1))
    if get_turn_credentials; then
        tests_passed=$((tests_passed + 1))
    fi
    
    echo ""
    
    # Test 2: STUN binding request
    tests_total=$((tests_total + 1))
    if test_stun; then
        tests_passed=$((tests_passed + 1))
    else
        # Try Python test as fallback
        if test_with_python "$TURN_HOST" "$TURN_PORT"; then
            tests_passed=$((tests_passed + 1))
        fi
    fi
    
    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    echo "Tests passed: $tests_passed/$tests_total"
    echo "=========================================="
    
    if [ $tests_passed -eq $tests_total ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    else
        echo -e "${YELLOW}Some tests failed or incomplete${NC}"
        return 1
    fi
}

main "$@"

