import { PoolClient } from "pg";
import { IDebugger } from "./debug";

export type WithPgClient = <T = void>(
  callback: (pgClient: PoolClient) => Promise<T>
) => Promise<T>;

export interface Helpers {
  job: Job;
  debug: IDebugger;
  withPgClient: WithPgClient;
}

export type Task = (payload: unknown, helpers: Helpers) => Promise<void>;

export function isValidTask(fn: any): fn is Task {
  if (typeof fn === "function") {
    return true;
  }
  return false;
}

export interface TaskList {
  [name: string]: Task;
}

export interface WatchedTaskList {
  tasks: TaskList;
  release: () => void;
}

export interface Job {
  id: number;
  queue_name: string;
  task_identifier: string;
  payload: unknown;
  priority: number;
  run_at: Date;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Worker {
  nudge: () => boolean;
  workerId: string;
  release: () => void;
  promise: Promise<void>;
  getActiveJob: () => Job | null;
}

export interface WorkerPool {
  release: () => Promise<void>;
  gracefulShutdown: (message: string) => Promise<void>;
  promise: Promise<void>;
}
