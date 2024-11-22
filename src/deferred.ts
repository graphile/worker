export interface Deferred<T = void> extends Promise<T> {
  resolve: (result?: T | PromiseLike<T>) => void;
  reject: (error: Error) => void;
}

export default function defer<T = void>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"];
  let reject: Deferred<T>["reject"];
  return Object.assign(
    new Promise<T>((_resolve, _reject) => {
      resolve = _resolve as Deferred<T>["resolve"];
      reject = _reject;
    }),
    // @ts-ignore error TS2454: Variable 'resolve' is used before being assigned.
    { resolve, reject },
  );
}
