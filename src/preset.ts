import { makeWorkerPresetWorkerOptions } from "./config.ts";
import { LoadTaskFromExecutableFilePlugin } from "./plugins/LoadTaskFromExecutableFilePlugin.ts";
import { LoadTaskFromJsPlugin } from "./plugins/LoadTaskFromJsPlugin.ts";

export const WorkerPreset: GraphileConfig.Preset = {
  plugins: [LoadTaskFromJsPlugin, LoadTaskFromExecutableFilePlugin],
  worker: makeWorkerPresetWorkerOptions(),
};

export const EMPTY_PRESET: GraphileConfig.Preset = Object.freeze({});
