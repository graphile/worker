// For backwards compatibility
if (process.env.GRAPHILE_WORKER_DEBUG) {
  process.env.GRAPHILE_LOGGER_DEBUG = process.env.GRAPHILE_WORKER_DEBUG;
}

import {
  LogFunctionFactory as GraphileLogFunctionFactory,
  Logger as GraphileLogger,
  makeConsoleLogFactory,
} from "@graphile/logger";

export interface LogScope {
  label?: string;
  workerId?: string;
  taskIdentifier?: string;
  jobId?: string;
}

// For backwards compatibility
export type Logger = GraphileLogger<LogScope>;
export type LogFunctionFactory = GraphileLogFunctionFactory<LogScope>;
export const consoleLogFactory = makeConsoleLogFactory<LogScope>();

export const defaultLogger = new GraphileLogger<LogScope>(
  makeConsoleLogFactory({
    format: `[%s%s] %s: %s`,
    formatParameters(level, message, scope) {
      const taskText = scope.taskIdentifier ? `: ${scope.taskIdentifier}` : "";
      const jobIdText = scope.jobId ? `{${scope.jobId}}` : "";
      return [
        scope.label || "core",
        scope.workerId ? `(${scope.workerId}${taskText}${jobIdText})` : "",
        level.toUpperCase(),
        message,
      ];
    },
  }),
);
