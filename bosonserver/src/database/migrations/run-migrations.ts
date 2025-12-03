import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../postgres';
import { logger } from '../../utils/logger';

// In production (compiled), migrations are in dist/database/migrations
// In development, they're in src/database/migrations
// Try dist first, then fallback to src
let migrationsDir = __dirname;
if (!__dirname.includes('dist')) {
  // Development mode - use src directory
  migrationsDir = join(__dirname.replace(/dist/g, 'src'));
}

const migrations = [
  '001_create_nodes_table.sql',
  '002_create_routes_table.sql',
  '003_create_metrics_table.sql',
  '004_create_sessions_table.sql',
];

async function runMigrations(): Promise<void> {
  try {
    logger.info('Running database migrations...');

    // Create migrations tracking table
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const appliedMigrations = await db.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const appliedVersions = new Set(appliedMigrations.map((m) => m.version));

    // Run pending migrations
    for (const migration of migrations) {
      const version = migration.replace('.sql', '');
      if (appliedVersions.has(version)) {
        logger.info(`Migration ${version} already applied, skipping`);
        continue;
      }

      logger.info(`Applying migration ${version}...`);
      const sql = readFileSync(join(migrationsDir, migration), 'utf-8');
      
      await db.transaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
      });

      logger.info(`Migration ${version} applied successfully`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error });
    throw error;
  }
}

export { runMigrations };

