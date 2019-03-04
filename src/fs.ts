import * as rawFs from "fs";
import { promisify } from "util";

export const stat = promisify(rawFs.stat);
export const readFile = promisify(rawFs.readFile);
export const readdir = promisify(rawFs.readdir);

export async function tryStat(pathToStat: string) {
  try {
    return await stat(pathToStat);
  } catch (e) {
    return null;
  }
}
