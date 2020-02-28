import { WorkerSharedOptions } from "./interfaces";
import { Logger, defaultLogger, LogScope } from "./logger";
import { Client } from "pg";
import { POLL_INTERVAL, MAX_CONTIGUOUS_ERRORS } from "./config";

interface CompiledOptions {
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  pollInterval: number;
  maxContiguousErrors: number;
}

const _sharedOptionsCache = new WeakMap<WorkerSharedOptions, CompiledOptions>();

export function processSharedOptions(
  options: WorkerSharedOptions,
  {
    scope,
  }: {
    scope?: LogScope;
  } = {}
): CompiledOptions {
  let compiled = _sharedOptionsCache.get(options);
  if (!compiled) {
    const {
      logger = defaultLogger,
      schema: workerSchema = "graphile_worker",
      pollInterval = POLL_INTERVAL,
    } = options;
    const escapedWorkerSchema = Client.prototype.escapeIdentifier(workerSchema);
    compiled = {
      logger,
      workerSchema,
      escapedWorkerSchema,
      pollInterval,
      maxContiguousErrors: MAX_CONTIGUOUS_ERRORS,
    };
    _sharedOptionsCache.set(options, compiled);
  }
  if (scope) {
    return {
      ...compiled,
      logger: compiled.logger.scope(scope),
    };
  } else {
    return compiled;
  }
}
