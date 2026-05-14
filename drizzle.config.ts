import type { Config } from 'drizzle-kit';

export default {
  schema: './server/src/db/schema.ts',
  out: './server/src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.VE_DB_PATH ?? './var/varrok-edge.db',
  },
} satisfies Config;
