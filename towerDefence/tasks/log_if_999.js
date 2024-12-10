const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = ({ id, sleepTime }) => {
  if (id === 999) {
    console.log("Found 999!");
  }
  if (sleepTime) {
    return sleep(sleepTime);
  }
};
