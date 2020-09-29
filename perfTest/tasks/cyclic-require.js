const { n } = require("../n");

module.exports = ({ id }) => {
  if (id === n) {
    console.log(`Found ${n}!`);
  }
};
