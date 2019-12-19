import { Pool } from "pg";
import { PublisherOptions, Publisher } from "./interfaces";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { migrate } from "./migrate";
import { defaultLogger } from "./logger";
import { withReleasers, assertPool } from "./runner";

const processPublisherOptions = async (options: PublisherOptions) => {
  const { logger = defaultLogger } = options;
  return withReleasers(async (releasers, _) => {
    const pgPool: Pool = await assertPool(options, releasers, logger);

    const withPgClient = makeWithPgClientFromPool(pgPool);

    // Migrate
    await withPgClient(client => migrate(client));

    return { pgPool, withPgClient };
  });
};
export const runPublisher = async (
  options: PublisherOptions
): Promise<Publisher> => {
  const { withPgClient } = await processPublisherOptions(options);

  return {
    addJob: makeAddJob(withPgClient),
  };
};
