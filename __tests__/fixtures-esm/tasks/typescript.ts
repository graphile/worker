import type { JobHelpers } from "../../../src/interfaces.ts";

export default function typescriptTask(_payload: unknown, helpers: JobHelpers) {
  helpers.logger.debug("typescript task");
  return "some typescript";
}
