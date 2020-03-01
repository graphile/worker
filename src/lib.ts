import { SharedOptions } from "./interfaces";
import { Logger, defaultLogger, LogScope } from "./logger";
import { Client } from "pg";
import { MAX_CONTIGUOUS_ERRORS } from "./config";

interface CompiledOptions {
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  maxContiguousErrors: number;
}

const _sharedOptionsCache = new WeakMap<SharedOptions, CompiledOptions>();
export function processSharedOptions(
  options: SharedOptions,
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
      schema: workerSchema = process.env.GRAPHILE_WORKER_SCHEMA ||
        "graphile_worker",
    } = options;
    const escapedWorkerSchema = Client.prototype.escapeIdentifier(workerSchema);
    compiled = {
      logger,
      workerSchema,
      escapedWorkerSchema,
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
