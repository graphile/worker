import { GraphileConfig } from "graphile-config";

import type {} from "../src/index.js";

const preset: GraphileConfig.Preset = {
  worker: {
    connectionString: "postgres:///graphile_worker_test",
    concurrentJobs: 3,
    fileExtensions: [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"],
  },
};
export default preset;
