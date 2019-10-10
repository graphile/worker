import * as winston from "winston";
import { Logger } from "winston";
import { LOGGER_LEVEL } from "./config";

const container = new winston.Container();

const winstonOptions = {
  level: LOGGER_LEVEL,
  format: winston.format.json(),
  defaultMeta: { "worker-id": "graphile-worker" },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
};

export const logger: Logger = container.add("default", winstonOptions);

export { Logger };

export const loggerFactory = (identifier: string): Logger => {
  if (container.has(identifier)) {
    return container.get(identifier);
  } else {
    return container.add(identifier, {
      ...winstonOptions,
      defaultMeta: { "worker-id": identifier },
    });
  }
};
