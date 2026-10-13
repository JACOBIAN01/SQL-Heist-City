// Vitest global setup: gives PostgreSQL tests a database.
// TEST_DATABASE_URL wins (CI points it at a service container); otherwise the repo's
// private cluster is started when PostgreSQL's programs can be found; otherwise the
// PostgreSQL tests are skipped, loudly.
import { devUrl, start } from './pg-dev.mjs';

export default function setup() {
  if (process.env.TEST_DATABASE_URL) return;
  try {
    start();
    process.env.TEST_DATABASE_URL = devUrl('heist_test');
  } catch (err) {
    console.warn(`PostgreSQL tests skipped: ${err.message}`);
  }
}
