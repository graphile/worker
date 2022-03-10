import { readFile } from "../src/fs";
import { withPgClient } from "./helpers";

// Runs once before all test suites.
// See: https://jestjs.io/docs/configuration#globalsetup-string
export default async function globalSetup() {
  // Install pgcrypto when using PostgreSQL 12 or below
  const queryTextPromise = readFile(
    `${__dirname}/../scripts/ensure_gen_random_uuid_exists.sql`,
    "utf8",
  );
  return withPgClient(async (pgClient) => {
    pgClient.on("notice", ({ message }) => console.log(`\n${message}`));
    const queryText = await queryTextPromise;
    return pgClient.query(queryText);
  });
}
