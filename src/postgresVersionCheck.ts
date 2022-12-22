import { PoolClient } from "pg";

export async function doPostgresVersionCheck(client: PoolClient) {
  const versionResult = await client.query(`show server_version`);
  const versionString = versionResult.rows[0].server_version;
  const version = parseFloat(versionString);

  if (version < 12.0) {
    throw new Error(
      `Postgres version ${versionString} detected, 12.0 or greater required!`,
    );
  }
}
