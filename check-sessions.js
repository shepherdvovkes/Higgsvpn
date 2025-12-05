const { db } = require('./bosonserver/dist/database/postgres');

async function checkSessions() {
  try {
    const sessions = await db.query(
      'SELECT client_id, session_id, status, created_at, expires_at FROM sessions WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 10'
    );
    console.log('Active Sessions:');
    console.log(JSON.stringify(sessions, null, 2));
    
    const routes = await db.query(
      'SELECT id, client_id, created_at FROM routes WHERE expires_at > NOW() AND client_id IS NOT NULL ORDER BY created_at DESC LIMIT 10'
    );
    console.log('\nActive Routes:');
    console.log(JSON.stringify(routes, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSessions();

