declare global {
  namespace GraphileWorker {
    interface Tasks {
      latency: { id: number };
    }
  }
}

// Has to be a module, so export something
export type Foo = "Foo";
