import * as winston from "winston";
import {Logger} from "winston";
import * as  path from "path";
import { LOGGER_LEVEL } from "./config";

const errorFilePath = path.resolve('..','logs','error.logs');
const combinedErrorFilePath = path.resolve('..','logs','combined.logs');


const container = new winston.Container();

const winstonOptions = {
    level: LOGGER_LEVEL,
    format: winston.format.json(),
    defaultMeta: { "worker-id": "dfault-graphile-worker" },
    transports: [
        //
        // - Write to all logs with level `info` and below to `combined.log` 
        // - Write all logs error (and below) to `error.log`.
        //
        new winston.transports.File({ filename: errorFilePath, level: 'error' }),
        new winston.transports.File({ filename: combinedErrorFilePath }),
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
};


export const logger : Logger = container.add('default', winstonOptions);

export { Logger }; 

export const loggerFactory = (identifier: string): Logger => {
    if(container.has(identifier) ) {
        return container.get(identifier)
    } else {
       return container.add(identifier,{ ...winstonOptions, defaultMeta: { "worker-id": identifier}})
    }
}