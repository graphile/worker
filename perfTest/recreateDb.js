const { Pool } = require("pg");
const { parse } = require("pg-connection-string");

const config = parse(process.env.PERF_DATABASE_URL);
// don't connect to the provided db, or we can't drop it
const pgPool = new Pool({ ...config, database: "template1" });

async function main() {
  console.log(`Recreating database ${config.database}`);
  await pgPool.query(`drop database if exists ${config.database};`);
  await pgPool.query(`create database ${config.database};`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});