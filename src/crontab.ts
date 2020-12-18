import * as JSON5 from "json5";

import { CronItem, CronItemOptions } from "./interfaces";

const SECOND = 1000; /*milliseconds*/
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const CRONTAB_LINE_PARTS = /^([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+(.*)$/;
const CRONTAB_NUMBER = /^([0-9]+)$/;
const CRONTAB_RANGE = /^([0-9]+)-([0-9]+)$/;
const CRONTAB_WILDCARD = /^\*(?:\/([0-9]+))?$/;
const CRONTAB_COMMAND = /^([_a-zA-Z][_a-zA-Z0-9:_-]*)(?:\s+!([^\s]+))?(?:\s+(\{.*\}))?$/;
const CRONTAB_OPTIONS_ID = /^id=([a-zA-Z0-9]+)$/;
const CRONTAB_OPTIONS_BACKFILL = /^fill=((?:[0-9]+[smhdw])+)$/;
const CRONTAB_OPTIONS_MAX = /^max=([0-9]+)$/;
const CRONTAB_OPTIONS_QUEUE = /^queue=([-a-zA-Z0-9_:]+)$/;
const CRONTAB_OPTIONS_PRIORITY = /^max=([0-9]+)$/;

/**
 * Parses a range from a crontab line; a comma separated list of:
 *
 * - exact number
 * - wildcard `*` optionally with `/n` divisor
 * - range `a-b`
 *
 * Returns an ordered list of unique numbers in the range `min` to `max` that match the given range.
 *
 * If `wrap` is true, then the number `max + 1` will be replaced by the number
 * `min`; this is specifically to handle the value `7` being used to represent
 * Sunday (as opposed to `0` which is correct).
 */
const parseCrontabRange = (
  locationForError: string,
  range: string,
  min: number,
  max: number,
  wrap = false,
): number[] => {
  const parts = range.split(",");
  const numbers: number[] = [];

  /**
   * Adds a number to our numbers array after wrapping it (if necessary) and
   * checking it's in the valid range.
   */
  function add(number: number) {
    const wrappedNumber = wrap && number === max + 1 ? min : number;
    if (wrappedNumber > max) {
      throw new Error(
        `Too large value '${number}' in ${locationForError}: expected values in the range ${min}-${max}.`,
      );
    } else if (wrappedNumber < min) {
      throw new Error(
        `Too small value '${number}' in ${locationForError}: expected values in the range ${min}-${max}.`,
      );
    } else {
      numbers.push(wrappedNumber);
    }
  }

  for (const part of parts) {
    {
      const matches = CRONTAB_NUMBER.exec(part);
      if (matches) {
        add(parseInt(matches[1], 10));
        continue;
      }
    }
    {
      const matches = CRONTAB_RANGE.exec(part);
      if (matches) {
        const a = parseInt(matches[1], 10);
        const b = parseInt(matches[2], 10);
        if (b <= a) {
          throw new Error(
            `Invalid range '${part}' in ${locationForError}: destination is not larger than source`,
          );
        }
        for (let i = a; i <= b; i++) {
          add(i);
        }
        continue;
      }
    }
    {
      const matches = CRONTAB_WILDCARD.exec(part);
      if (matches) {
        const divisor = parseInt(matches[1], 10) || 1;
        for (let i = min; i <= max; i += divisor) {
          // We know this is fine, so no need to call `add`
          numbers.push(i);
        }
        continue;
      }
    }
    throw new Error(
      `Unsupported syntax '${part}' in ${locationForError}: this doesn't appear to be a number, range or wildcard`,
    );
  }

  numbers.sort((a, b) => a - b);

  // Filter out numbers that are identical to the previous number
  const uniqueNumbers = numbers.filter(
    (currentNumber, idx) => idx === 0 || numbers[idx - 1] !== currentNumber,
  );

  return uniqueNumbers;
};

const TIMEPHRASE_PART = /^([0-9]+)([smhdw])/;
const PERIOD_DURATIONS = {
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: WEEK,
};

/**
 * Returns a period of time in milliseconds representing the time phrase given.
 *
 * Time phrases are comprised of a sequence of number-letter combinations,
 * where the number represents a quantity and the letter represents a time
 * period, e.g.  `5d` for `five days`, or `3h` for `three hours`; e.g.
 * `4w3d2h1m` represents `four weeks, three days, 2 hours and 1 minute` (i.e. a
 * period of 44761 minutes).  The following time periods are supported:
 *
 * - `s` - one second (1000 milliseconds)
 * - `m` - one minute (60 seconds)
 * - `h` - one hour (60 minutes)
 * - `d` - on day (24 hours)
 * - `w` - one week (7 days)
 */
const parseTimePhrase = (timePhrase: string): number => {
  let remaining = timePhrase;
  let milliseconds = 0;
  while (remaining.length) {
    const matches = TIMEPHRASE_PART.exec(remaining);
    if (!matches) {
      throw new Error(`Invalid time phrase '${timePhrase}'`);
    }
    const [wholeMatch, quantity, period] = matches;
    const periodDuration = PERIOD_DURATIONS[period] || 0;
    milliseconds += parseInt(quantity, 10) * periodDuration;
    remaining = remaining.substr(wholeMatch.length);
  }
  return milliseconds;
};

const parseCrontabOptions = (
  lineNumber: number,
  optionsString: string | undefined,
): { options: CronItemOptions; identifier: string | undefined } => {
  const parts = optionsString != null ? optionsString.split("!") : [];
  let backfillPeriod: number | undefined = undefined;
  let maxAttempts: number | undefined = undefined;
  let identifier: string | undefined = undefined;
  let queueName: string | undefined = undefined;
  let priority: number | undefined = undefined;
  for (const part of parts) {
    {
      const matches = CRONTAB_OPTIONS_ID.exec(part);
      if (matches) {
        if (identifier !== undefined) {
          throw new Error(
            `Options on line ${lineNumber} of crontab specifies identifier more than once.`,
          );
        }
        identifier = matches[1];
        continue;
      }
    }
    {
      const matches = CRONTAB_OPTIONS_BACKFILL.exec(part);
      if (matches) {
        if (backfillPeriod !== undefined) {
          throw new Error(
            `Options on line ${lineNumber} of crontab specifies backfill count more than once.`,
          );
        }
        backfillPeriod = parseTimePhrase(matches[1]);
        continue;
      }
    }
    {
      const matches = CRONTAB_OPTIONS_MAX.exec(part);
      if (matches) {
        if (maxAttempts !== undefined) {
          throw new Error(
            `Options on line ${lineNumber} of crontab specifies max attempts more than once.`,
          );
        }
        maxAttempts = parseInt(matches[1], 10);
        continue;
      }
    }
    {
      const matches = CRONTAB_OPTIONS_QUEUE.exec(part);
      if (matches) {
        if (queueName !== undefined) {
          throw new Error(
            `Options on line ${lineNumber} of crontab specifies queue name more than once.`,
          );
        }
        queueName = matches[1];
        continue;
      }
    }
    {
      const matches = CRONTAB_OPTIONS_PRIORITY.exec(part);
      if (matches) {
        if (priority !== undefined) {
          throw new Error(
            `Options on line ${lineNumber} of crontab specifies priority more than once.`,
          );
        }
        priority = parseInt(matches[1], 10);
        continue;
      }
    }
    throw new Error(
      `Options on line ${lineNumber} of crontab contains unsupported expression '!${part}'.`,
    );
  }
  if (!backfillPeriod) {
    backfillPeriod = 0;
  }
  return {
    options: { backfillPeriod, maxAttempts },
    identifier,
  };
};

const parseCrontabPayload = (
  lineNumber: number,
  payloadString: string | undefined,
): any => {
  if (!payloadString) {
    return null;
  }
  try {
    return JSON5.parse(payloadString);
  } catch (e) {
    throw new Error(
      `Failed to parse JSON5 payload on line ${lineNumber} of crontab: ${e.message}`,
    );
  }
};

const parseCrontabCommand = (
  lineNumber: number,
  command: string,
): Pick<CronItem, "task" | "options" | "payload" | "identifier"> => {
  const matches = CRONTAB_COMMAND.exec(command);
  if (!matches) {
    throw new Error(
      `Invalid command specification in line ${lineNumber} of crontab.`,
    );
  }
  const [, task, optionsString, payloadString] = matches;
  const { options, identifier = task } = parseCrontabOptions(
    lineNumber,
    optionsString,
  );
  const payload = parseCrontabPayload(lineNumber, payloadString);
  return { task, options, payload, identifier };
};

/**
 * Parses a line from a crontab file, such as `* * * * * my_task`
 */
export const parseCrontabLine = (
  crontabLine: string,
  lineNumber: number,
): CronItem => {
  const matches = CRONTAB_LINE_PARTS.exec(crontabLine);
  if (!matches) {
    throw new Error(
      `Could not process line '${lineNumber}' of crontab: '${crontabLine}'`,
    );
  }
  const minutes = parseCrontabRange(
    `range 1 in line ${lineNumber} of crontab`,
    matches[1],
    0,
    59,
  );
  const hours = parseCrontabRange(
    `range 2 in line ${lineNumber} of crontab`,
    matches[2],
    0,
    23,
  );
  const dates = parseCrontabRange(
    `range 3 in line ${lineNumber} of crontab`,
    matches[3],
    1,
    31,
  );
  const months = parseCrontabRange(
    `range 4 in line ${lineNumber} of crontab`,
    matches[4],
    1,
    12,
  );
  const dows = parseCrontabRange(
    `range 5 in line ${lineNumber} of crontab`,
    matches[5],
    0,
    6,
    true,
  );
  const { task, options, payload, identifier } = parseCrontabCommand(
    lineNumber,
    matches[6],
  );

  return {
    minutes,
    hours,
    dates,
    months,
    dows,
    task,
    options,
    payload,
    identifier,
  };
};

export const parseCrontab = (crontab: string): Array<CronItem> => {
  const lines = crontab.split(/\r?\n/);
  const items: CronItem[] = [];
  for (
    let lineNumber = 1, numberOfLines = lines.length;
    lineNumber <= numberOfLines;
    lineNumber++
  ) {
    const line = lines[lineNumber - 1];
    if (line.startsWith("#") || line.trim() === "") {
      // Ignore comment lines and empty lines
      continue;
    }
    items.push(parseCrontabLine(line, lineNumber));
  }

  // Assert that identifiers are unique
  const identifiers = items.map((i) => i.identifier);
  identifiers.sort();
  const duplicates = identifiers.filter(
    (id, i) => i > 0 && id === identifiers[i - 1],
  );
  if (duplicates.length) {
    throw new Error(
      `Invalid crontab; duplicate identifiers found: '${duplicates.join(
        "', '",
      )}' - please use '!id=...' to specify unique identifiers for your cron items`,
    );
  }

  return items;
};
