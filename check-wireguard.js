// Check WireGuard server status
// This script checks if the WireGuard UDP server is running and shows registered clients

async function checkWireGuard() {
  try {
    console.log('=== WireGuard Server Status ===\n');
    
    // Check if port 51820 is listening
    const { execSync } = require('child_process');
    
    try {
      const netstat = execSync('netstat -tulpn 2>/dev/null | grep 51820 || ss -tulpn | grep 51820', { encoding: 'utf-8' });
      console.log('Port 51820 Status:');
      console.log(netstat.trim());
    } catch (e) {
      console.log('Port 51820: Not listening or cannot check');
    }
    
    // Check firewall rules
    try {
      const iptables = execSync('sudo iptables -L -n | grep 51820', { encoding: 'utf-8' });
      console.log('\nFirewall Rules (iptables):');
      console.log(iptables.trim());
    } catch (e) {
      console.log('\nFirewall: Cannot check iptables');
    }
    
    try {
      const ufw = execSync('sudo ufw status 2>/dev/null | grep 51820', { encoding: 'utf-8' });
      console.log('\nFirewall Rules (UFW):');
      console.log(ufw.trim());
    } catch (e) {
      // UFW might not be installed or configured
    }
    
    // Check WireGuard tools
    try {
      const wgVersion = execSync('wg --version', { encoding: 'utf-8' });
      console.log('\nWireGuard Tools:');
      console.log(wgVersion.trim());
    } catch (e) {
      console.log('\nWireGuard Tools: Not found');
    }
    
    // Check for WireGuard interfaces
    try {
      const wgShow = execSync('sudo wg show', { encoding: 'utf-8' });
      console.log('\nWireGuard Interfaces:');
      if (wgShow.trim()) {
        console.log(wgShow.trim());
      } else {
        console.log('No WireGuard kernel interfaces configured');
        console.log('(This is normal - bosonserver uses UDP server, not kernel interface)');
      }
    } catch (e) {
      console.log('\nWireGuard Interfaces: Cannot check (may require sudo)');
    }
    
    // Check network interfaces
    try {
      const ipAddr = execSync('ip addr show | grep -A 3 wg', { encoding: 'utf-8' });
      if (ipAddr.trim()) {
        console.log('\nNetwork Interfaces (wg*):');
        console.log(ipAddr.trim());
      } else {
        console.log('\nNetwork Interfaces: No wg* interfaces found');
      }
    } catch (e) {
      console.log('\nNetwork Interfaces: No wg* interfaces');
    }
    
    console.log('\n=== Summary ===');
    console.log('Bosonserver WireGuard Server:');
    console.log('  - Type: UDP Server (not kernel interface)');
    console.log('  - Port: 51820');
    console.log('  - Implementation: Node.js dgram.Socket');
    console.log('  - Purpose: Relay WireGuard packets between clients and nodes');
    console.log('\nNote: This is a custom UDP relay server, not a traditional WireGuard kernel interface.');
    console.log('The server listens for WireGuard protocol packets and forwards them to nodes.');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkWireGuard();

