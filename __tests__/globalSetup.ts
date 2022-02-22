import { withPgPool } from "./helpers";

const PG13_VERSION_NUM = 130000;

// Runs once before all test suites.
// See: https://jestjs.io/docs/configuration#globalsetup-string
export default async function globalSetup() {
  return withPgPool(async (pgPool) => {
    const { rows } = await pgPool.query<[number, string]>({
      text: `select current_setting('server_version_num')::integer, current_setting('server_version');`,
      rowMode: "array",
    });
    const [serverVersionNum, serverVersion] = rows[0];

    if (serverVersionNum < PG13_VERSION_NUM) {
      console.log(
        `\nPostgreSQL ${serverVersion} detected, pgcrypto will be installed.`,
      );
      await pgPool.query(
        `create extension if not exists pgcrypto with schema public;`,
      );
    }
  });
}
