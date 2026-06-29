import faktory from "faktory-worker";

export default async function faktoryExporter(payload, helpers) {
  const { param } = payload;
  const { logger } = helpers;

  // https://github.com/contribsys/faktory/wiki/The-Job-Payload
  const payloadOptions = {
    jobType: "FaktoryJob",
    queue: "graphile",
    args: [param],
  };
  const faktoryClient = await faktory.connect();

  const jid = await faktoryClient.push(payloadOptions);

  logger.info(`Received jid from Faktory: ${jid}. Thanks Faktory!`);

  await faktoryClient.close();
}
