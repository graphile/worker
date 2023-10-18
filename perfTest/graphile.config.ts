import { GraphileConfig } from "graphile-config";

import type {} from "../src/index.js";

const preset: GraphileConfig.Preset = {
  worker: {
    connectionString: "postgres:///graphile_worker_test",
    concurrentJobs: 3,
  },
};
export default preset;
