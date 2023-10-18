const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = (_payload) => {
  return sleep(30_000);
};
