declare global {
  namespace GraphileWorker {
    interface Tasks {
      latency: { id: number };
    }
  }
}

export type Foo = "Foo";
