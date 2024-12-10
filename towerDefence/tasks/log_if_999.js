const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = async ({ id }) => {
  await sleep(250);
  if (id === 999) {
    console.log("Found 999!");
  }
};
