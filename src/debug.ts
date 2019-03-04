import debug, { IDebugger } from "debug";

export { IDebugger };

export default debug("graphile-worker");

export function debugFactory(namespace: string) {
  return debug(`graphile-worker:${namespace}`);
}
