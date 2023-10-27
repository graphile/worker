import { stat } from "node:fs/promises";

export async function tryStat(pathToStat: string) {
  try {
    return await stat(pathToStat);
  } catch (e) {
    return null;
  }
}
