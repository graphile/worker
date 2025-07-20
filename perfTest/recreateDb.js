const {
  createNodePostgresPool,
} = require("@graphile/pg-adapter-node-postgres");
const { parse } = require("pg-connection-string");
const { ident } = require("@graphile/pg-core");

if (!process.env.PERF_DATABASE_URL) {
  throw new Error(
    "No PERF_DATABASE_URL setting detected; please don't call this script directly!",
  );
}
const config = parse(process.env.PERF_DATABASE_URL);
// don't connect to the provided db, or we can't drop it

async function main() {
  const pgPool = await createNodePostgresPool({
    ...config,
    database: "template1",
  });
  await pgPool.withPgClient(async (pgClient) => {
    const dbName = ident(config.database);
    console.log(`Recreating database ${config.database}`);

    await pgClient.execute(`drop database if exists ${dbName};`);
    await pgClient.execute(`create database ${dbName};`);
  });

  await pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
