import { Pool } from "pg";

import { KnownCrontab, run, runMigrations, RunnerOptions } from "../src";
import { withPgPool } from "./helpers";

function withOptions<T>(
  callback: (options: RunnerOptions & { pgPool: Pool }) => Promise<T>,
) {
  return withPgPool((pgPool) =>
    callback({
      pgPool,
      taskList: {
        do_it(payload, helpers) {
          helpers.logger.debug("do_it called", { payload });
        },
      },
    }),
  );
}

const CRONTAB_DO_IT = `
* * * * * do_it
`;

async function getKnown(pgPool: Pool) {
  const { rows } = await pgPool.query<KnownCrontab>(
    `select * from graphile_worker.known_crontabs`,
  );
  return rows;
}

test("registers identifiers", () =>
  withOptions(async (options) => {
    await runMigrations(options);
    {
      const known = await getKnown(options.pgPool);
      expect(known).toHaveLength(0);
    }
    const runner = await run({
      ...options,
      crontab: CRONTAB_DO_IT,
    });
    await runner.stop();
    {
      const known = await getKnown(options.pgPool);
      expect(known).toHaveLength(1);
      expect(known[0].identifier).toEqual("do_it");
      expect(known[0].known_since).not.toBeNull();
      expect(known[0].last_execution).toBeNull();
    }
  }));
