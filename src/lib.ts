import { WorkerSharedOptions } from "./interfaces";
import { Logger, defaultLogger } from "./logger";
import { Client } from "pg";

interface CompiledOptions {
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
}

const _sharedOptionsCache = new WeakMap<WorkerSharedOptions, CompiledOptions>();

export function processSharedOptions(
  options: WorkerSharedOptions
): CompiledOptions {
  let compiled = _sharedOptionsCache.get(options);
  if (compiled) {
    return compiled;
  }
  const {
    logger = defaultLogger,
    schema: workerSchema = "graphile_worker",
  } = options;
  const escapedWorkerSchema = Client.prototype.escapeIdentifier(workerSchema);
  compiled = {
    logger,
    workerSchema,
    escapedWorkerSchema,
  };
  _sharedOptionsCache.set(options, compiled);
  return compiled;
}
