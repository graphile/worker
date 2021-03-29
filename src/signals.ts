export type Signal =
  | "SIGUSR2"
  | "SIGINT"
  | "SIGTERM"
  // | "SIGPIPE"
  | "SIGHUP"
  | "SIGABRT";

export default [
  "SIGUSR2",
  "SIGINT",
  "SIGTERM",
  /*
   * Though SIGPIPE is a terminal signal _normally_, this isn't the case for
   * Node.js since libuv handles it. From the Node docs:
   *
   * > 'SIGPIPE' is ignored by default. It can have a listener installed.
   * > -- https://nodejs.org/api/process.html
   *
   * We don't want the process to exit on SIGPIPE, so we ignore it (and rely on
   * Node.js to handle it through the normal error channels).
   */
  // "SIGPIPE",
  "SIGHUP",
  "SIGABRT",
] as Array<Signal>;
