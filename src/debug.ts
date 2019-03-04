import debug, { IDebugger } from "debug";

export { IDebugger };

export default debug("graphile-worker");

const debuggers: {
  [namespace: string]: IDebugger;
} = {};

export function debugFactory(namespace: string): IDebugger {
  if (!debuggers[namespace]) {
    debuggers[namespace] = debug(`graphile-worker:${namespace}`);
  }
  return debuggers[namespace];
}
