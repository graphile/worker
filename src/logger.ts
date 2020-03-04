export interface LogScope {
  label?: string;
  workerId?: string;
  taskIdentifier?: string;
  jobId?: string;
}

export interface LogMeta {
  [key: string]: unknown;
}

// Inspired by the 'winston' levels: https://github.com/winstonjs/winston#logging-levels
export enum LogLevel {
  ERROR = "error",
  WARNING = "warning",
  INFO = "info",
  DEBUG = "debug",
}

export interface LogFunction {
  (level: LogLevel, message: string, meta?: LogMeta): void;
}

export interface LogFunctionFactory {
  (scope: LogScope): LogFunction;
}

export class Logger {
  private _scope: LogScope;
  private _logFactory: LogFunctionFactory;

  private log: LogFunction;

  constructor(logFactory: LogFunctionFactory, scope: LogScope = {}) {
    this._scope = scope;
    this._logFactory = logFactory;

    this.log = logFactory(scope);
  }

  scope(additionalScope: LogScope) {
    return new Logger(this._logFactory, { ...this._scope, ...additionalScope });
  }

  error(message: string, meta?: LogMeta): void {
    return this.log(LogLevel.ERROR, message, meta);
  }
  warn(message: string, meta?: LogMeta): void {
    return this.log(LogLevel.WARNING, message, meta);
  }
  info(message: string, meta?: LogMeta): void {
    return this.log(LogLevel.INFO, message, meta);
  }
  debug(message: string, meta?: LogMeta): void {
    return this.log(LogLevel.DEBUG, message, meta);
  }
}

// The default console logger does not output metadata
export const consoleLogFactory = (scope: LogScope) => (
  level: LogLevel,
  message: string,
) => {
  if (level === LogLevel.DEBUG && !process.env.GRAPHILE_WORKER_DEBUG) {
    return;
  }
  let method: "error" | "warn" | "info" | "log" = (() => {
    switch (level) {
      case LogLevel.ERROR:
        return "error";
      case LogLevel.WARNING:
        return "warn";
      case LogLevel.INFO:
        return "info";
      default:
        return "log";
    }
  })();
  console[method](
    `[%s%s] %s: %s`,
    scope.label || "core",
    scope.workerId
      ? `(${scope.workerId}${
          scope.taskIdentifier ? `: ${scope.taskIdentifier}` : ""
        }${scope.jobId ? `{${scope.jobId}}` : ""})`
      : "",
    level.toUpperCase(),
    message,
  );
};

export const defaultLogger = new Logger(consoleLogFactory);
