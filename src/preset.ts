import { makeWorkerPresetWorkerOptions } from "./config";
import { LoadTaskFromExecutableFilePlugin } from "./plugins/LoadTaskFromExecutableFilePlugin";
import { LoadTaskFromJsPlugin } from "./plugins/LoadTaskFromJsPlugin";

export const WorkerPreset: GraphileConfig.Preset = {
  plugins: [LoadTaskFromJsPlugin, LoadTaskFromExecutableFilePlugin],
  worker: makeWorkerPresetWorkerOptions(),
};

export const EMPTY_PRESET: GraphileConfig.Preset = Object.freeze({});
