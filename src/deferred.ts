export interface Deferred<T> extends Promise<T> {
  resolve: (result?: T) => void;
  reject: (error: Error) => void;
}

export default function deferred<T = void>(): Deferred<T> {
  let resolve: (result?: T) => void;
  let reject: (error: Error) => void;
  return Object.assign(
    new Promise<T>((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    }),
    // @ts-ignore Non-sense, these aren't used before being defined.
    { resolve, reject }
  );
}
