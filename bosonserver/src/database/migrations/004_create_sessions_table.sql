-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(255) PRIMARY KEY,
  node_id VARCHAR(255) NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  route_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  relay_endpoint TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_sessions_node_id ON sessions(node_id);
CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Foreign key to nodes (optional, can be added if needed)
-- ALTER TABLE sessions ADD CONSTRAINT fk_sessions_node_id 
--   FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE;

