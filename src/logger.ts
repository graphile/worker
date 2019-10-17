export class Logger {
  defaultMeta: any;
  constructor(meta: any) {
    this.defaultMeta = meta;
  }
  info(message: string, meta?: any) {
    // eslint-disable-next-line no-console
    console.log(`${this.defaultMeta.workerId} ${message}`, meta);
  }
  error(message: string, meta?: any) {
    // eslint-disable-next-line no-console
    console.error(`${this.defaultMeta.workerId} ${message}`, meta);
  }
  degug(message: string, meta?: any) {
    // eslint-disable-next-line no-console
    console.debug(`${this.defaultMeta.workerId} ${message}`, meta);
  }
}

const loggers: {
  [identifier: string]: Logger;
} = {};

export const defaultLogger = new Logger({ workerId: "graphile-worker" });

export const loggerFactory = (identifier: string): Logger => {
  if (loggers[identifier]) {
    return loggers[identifier];
  } else {
    return (loggers[identifier] = new Logger({ workerId: identifier }));
  }
};
