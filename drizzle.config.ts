import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/adapters/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.HH_DB_PATH ?? './data/hh.db',
  },
  verbose: true,
  strict: false,
});