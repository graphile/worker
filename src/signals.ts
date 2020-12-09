export type Signal =
  | "SIGUSR2"
  | "SIGINT"
  | "SIGTERM"
  | "SIGPIPE"
  | "SIGHUP"
  | "SIGABRT";

export default [
  "SIGUSR2",
  "SIGINT",
  "SIGTERM",
  "SIGPIPE",
  "SIGHUP",
  "SIGABRT",
] as Array<Signal>;
