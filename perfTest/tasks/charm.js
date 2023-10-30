module.exports = async (payload, { job }) => {
  if (job.attempts < 3) {
    throw new Error(`Throwing error because attempt ${job.attempts} < 3`);
  } else {
    console.log(`Third time's the charm!`);
  }
};
