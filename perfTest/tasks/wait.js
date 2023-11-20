const sleep = (ms, abortSignal) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms);
    abortSignal?.addEventListener("abort", () => {
      reject(new Error("AbortSignal received"));
    });
  });
};
module.exports = (_payload, { abortSignal }) => {
  return sleep(30_000, abortSignal);
};
