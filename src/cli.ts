import { Pool } from "pg";
import { migrate } from "./migrate";

async function main() {
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  try {
    await migrate(pgPool);
  } finally {
    await pgPool.end();
  }
}

main().catch(e => {
  // tslint:disable-next-line no-console
  console.error(e);
  process.exit(1);
});
