import { promises as fsp } from "fs";

import { parseCrontab } from "./crontab";
import { ParsedCronItem, SharedOptions, WatchedCronItems } from "./interfaces";
import { processSharedOptions } from "./lib";
import { Logger } from "./logger";

async function loadCrontabIntoCronItems(
  logger: Logger,
  items: Array<ParsedCronItem>,
  filename: string,
) {
  let didntExist = false;
  const contents = await fsp
    .readFile(filename, "utf8")
    .then((t) => {
      if (didntExist) {
        didntExist = false;
        logger.info(`Found crontab file '${filename}'; cron is now enabled`);
      }
      return t;
    })
    .catch((e) => {
      if (e.code !== "ENOENT") {
        // Only log error if it's not a "file doesn't exist" error
        logger.error(`Failed to read crontab file '${filename}': ${e}`);
      } else {
        didntExist = true;
        logger.info(
          `Failed to read crontab file '${filename}'; cron is disabled`,
        );
      }
      return "";
    });
  if (contents != null) {
    const parsed = parseCrontab(contents);
    // Overwrite items' contents with the new cron items
    items.splice(0, items.length, ...parsed);
  }
}

export default async function getCronItems(
  options: SharedOptions,
  crontabPath: string,
): Promise<WatchedCronItems> {
  const { logger } = processSharedOptions(options);

  const items: Array<ParsedCronItem> = [];

  // Try and require it
  await loadCrontabIntoCronItems(logger, items, crontabPath);

  let released = false;
  return {
    items,
    release: () => {
      if (released) {
        return;
      }
      released = true;
    },
  };
}
