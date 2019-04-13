const faktory = require("faktory-worker");

module.exports = async ({ param }) => {
  // https://github.com/contribsys/faktory/wiki/The-Job-Payload
  const payloadOptions = {
    jobType: "FaktoryJob",
    queue: "graphile",
    args: [param],
  };
  const faktoryClient = await faktory.connect();

  const jid = await faktoryClient.push(payloadOptions);

  console.log(`Received jid from Faktory: ${jid}. Thanks Faktory!`);

  await faktoryClient.close();
};
