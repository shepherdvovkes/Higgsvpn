#!/usr/bin/env python3
"""
STUN Binding Request Test
Tests STUN server functionality by sending a proper STUN Binding Request
and verifying the response.
"""

import socket
import struct
import os
import sys

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
        
        print(f"Testing STUN on {host}:{port}")
        print(f"Sending STUN Binding Request ({len(request)} bytes)...")
        
        # Send request
        sock.sendto(request, (host, port))
        print("✓ STUN Binding Request sent")
        
        # Wait for response
        try:
            response, addr = sock.recvfrom(1024)
            print(f"✓ STUN Binding Response received from {addr}")
            print(f"  Response length: {len(response)} bytes")
            
            # Parse response
            if len(response) >= 20:
                msg_type = struct.unpack('!H', response[0:2])[0]
                msg_length = struct.unpack('!H', response[2:4])[0]
                magic_cookie = struct.unpack('!I', response[4:8])[0]
                
                print(f"  Message Type: 0x{msg_type:04x}", end="")
                if msg_type == 0x0101:
                    print(" (Binding Success Response)")
                elif msg_type == 0x0111:
                    print(" (Binding Error Response)")
                else:
                    print(" (Unknown)")
                
                print(f"  Message Length: {msg_length} bytes")
                print(f"  Magic Cookie: 0x{magic_cookie:08x}", end="")
                if magic_cookie == 0x2112A442:
                    print(" (valid)")
                else:
                    print(" (invalid!)")
                
                if msg_type == 0x0101:
                    print("\n✓ SUCCESS: STUN server is working correctly!")
                    print("  The server responded with a valid Binding Success Response")
                    return True
                else:
                    print(f"\n⚠ Got response but unexpected message type")
                    return False
            else:
                print("  ⚠ Response too short to be valid STUN message")
                return False
        except socket.timeout:
            print("  ⚠ No response received (timeout)")
            print("  This may indicate:")
            print("    - STUN server is not responding")
            print("    - Firewall is blocking UDP")
            print("    - Server is not configured for STUN")
            return False
        finally:
            sock.close()
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "mail.s0me.uk"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 3478
    
    success = test_stun(host, port)
    sys.exit(0 if success else 1)

