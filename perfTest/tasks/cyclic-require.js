const { n } = require("../n.js");

module.exports = ({ id }) => {
  if (id === n) {
    console.log(`Found ${n}!`);
  }
};
