const { Pool } = require("pg");
const { parse } = require("pg-connection-string");

if (!process.env.PERF_DATABASE_URL) {
  throw new Error(
    "No PERF_DATABASE_URL setting detected; please don't call this script directly!"
  );
}
const config = parse(process.env.PERF_DATABASE_URL);
// don't connect to the provided db, or we can't drop it

const pgPool = new Pool({ ...config, database: "template1" });

async function main() {
  const pgClient = await pgPool.connect();
  const dbName = pgClient.escapeIdentifier(config.database);
  console.log(`Recreating database ${config.database}`);

  try {
    await pgClient.query(`create database ${dbName};`);
  } finally {
    pgClient.release();
  }
}

main()
  .then(() => pgPool.end())
  .catch(e => {
  console.error(e);
  process.exit(1);
});
