import { GraphileConfig } from "graphile-config";
import { version } from "../version.js";
import { isValidTask } from "../index.js";

export const LoadTaskFromJsPlugin: GraphileConfig.Plugin = {
  name: "LoadTaskFromJsPlugin",
  version,

  worker: {
    hooks: {
      async loadTaskFromFiles(_info, mutableEvent, details) {
        const { fileDetailsList } = details;

        if (mutableEvent.handler) {
          // Already loaded; skip
          return;
        }

        const jsFile =
          fileDetailsList.find((d) => d.extension === ".js") ||
          fileDetailsList.find((d) => d.extension === ".mjs") ||
          fileDetailsList.find((d) => d.extension === ".cjs");
        if (!jsFile) {
          // Don't know how to handle; skip
          return;
        }

        try {
          const rawMod = await import(jsFile.fullPath);
          const mod =
            Object.keys(rawMod).length === 1 &&
            typeof rawMod.default === "object" &&
            rawMod.default !== null
              ? rawMod.default
              : rawMod;
          const task = mod.default || mod;
          if (isValidTask(task)) {
            mutableEvent.handler = task;
          } else {
            throw new Error(
              `Invalid task '${name}' - expected function, received ${
                task ? typeof task : String(task)
              }.`,
            );
          }
        } catch (error) {
          const message = `Error processing '${jsFile.fullPath}': ${error.message}`;
          throw new Error(message);
        }
      },
    },
  },
};
