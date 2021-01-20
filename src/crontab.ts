import * as JSON5 from "json5";
import { parse } from "querystring";

import { CronItem, CronItemOptions, ParsedCronItem } from "./interfaces";

/** One second in milliseconds */
const SECOND = 1000;
/** One minute in milliseconds */
const MINUTE = 60 * SECOND;
/** One hour in milliseconds */
const HOUR = 60 * MINUTE;
/** One day in milliseconds */
const DAY = 24 * HOUR;
/** One week in milliseconds */
const WEEK = 7 * DAY;

// A (non-comment, non-empty) line in the crontab file
/** Separates crontab line into the minute, hour, day of month, month, day of week and command parts. */
const CRONTAB_LINE_PARTS = /^([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+(.*)$/;
/** Just the time expression from CRONTAB_LINE_PARTS */
const CRONTAB_TIME_PARTS = /^([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)$/;

// Crontab ranges from the minute, hour, day of month, month and day of week parts of the crontab line
/** Matches an explicit numeric value */
const CRONTAB_NUMBER = /^([0-9]+)$/;
/** Matches a range of numeric values */
const CRONTAB_RANGE = /^([0-9]+)-([0-9]+)$/;
/** Matches a numeric wildcard, optionally with a divisor */
const CRONTAB_WILDCARD = /^\*(?:\/([0-9]+))?$/;

// The command from the crontab line
/** Splits the command from the crontab line into the task, options and payload. */
const CRONTAB_COMMAND = /^([_a-zA-Z][_a-zA-Z0-9:_-]*)(?:\s+\?([^\s]+))?(?:\s+(\{.*\}))?$/;

// Crontab command options
/** Matches the id=UID option, capturing the unique identifier */
const CRONTAB_OPTIONS_ID = /^([_a-zA-Z][-_a-zA-Z0-9]*)$/;
/** Matches the fill=t option, capturing the time phrase  */
const CRONTAB_OPTIONS_BACKFILL = /^((?:[0-9]+[smhdw])+)$/;
/** Matches the max=n option, capturing the max executions number */
const CRONTAB_OPTIONS_MAX = /^([0-9]+)$/;
/** Matches the queue=name option, capturing the queue name */
const CRONTAB_OPTIONS_QUEUE = /^([-a-zA-Z0-9_:]+)$/;
/** Matches the priority=n option, capturing the priority value */
const CRONTAB_OPTIONS_PRIORITY = /^(-?[0-9]+)$/;

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
        const divisor = matches[1] ? parseInt(matches[1], 10) : 1;
        if (divisor >= 1) {
          for (let i = min; i <= max; i += divisor) {
            // We know this is fine, so no need to call `add`
            numbers.push(i);
          }
        } else {
          throw new Error(
            `Invalid wildcard expression '${part}' in ${locationForError}: divisor '${matches[1]}' expected to be greater than zero`,
          );
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

/** Matches the quantity and period string at the beginning of a timephrase */
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
      throw new Error(
        `Invalid time phrase '${timePhrase}', did not understand '${remaining}'`,
      );
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
  const parsed = optionsString != null ? parse(optionsString) : {};
  let backfillPeriod: number | undefined = undefined;
  let maxAttempts: number | undefined = undefined;
  let identifier: string | undefined = undefined;
  let queueName: string | undefined = undefined;
  let priority: number | undefined = undefined;

  type MatcherTuple = [RegExp, (matches: RegExpExecArray) => void];

  const matchers: { [key: string]: MatcherTuple } = {
    id: [
      CRONTAB_OPTIONS_ID,
      (matches) => {
        identifier = matches[1];
      },
    ],
    fill: [
      CRONTAB_OPTIONS_BACKFILL,
      (matches) => {
        backfillPeriod = parseTimePhrase(matches[1]);
      },
    ],
    max: [
      CRONTAB_OPTIONS_MAX,
      (matches) => {
        maxAttempts = parseInt(matches[1], 10);
      },
    ],
    queue: [
      CRONTAB_OPTIONS_QUEUE,
      (matches) => {
        queueName = matches[1];
      },
    ],
    priority: [
      CRONTAB_OPTIONS_PRIORITY,
      (matches) => {
        priority = parseInt(matches[1], 10);
      },
    ],
  };

  function match(matcher: MatcherTuple, key: string, value: string) {
    const [regex, set] = matcher;
    const matches = regex.exec(value);
    if (matches) {
      set(matches);
    } else {
      throw new Error(
        `Options on line ${lineNumber} of crontab contains invalid value for '${key}', value '${value}' is not compatible with this option.`,
      );
    }
  }

  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof value !== "string") {
      throw new Error(
        `Options on line ${lineNumber} of crontab contains invalid value for '${key}', did you specify it more than once?`,
      );
    }
    const matcher = Object.prototype.hasOwnProperty.call(matchers, key)
      ? matchers[key]
      : null;
    if (matcher) {
      match(matcher, key, value);
    } else {
      throw new Error(
        `Options on line ${lineNumber} of crontab contains unsupported key '${key}'; supported keys are: '${Object.keys(
          matchers,
        ).join("', '")}'.`,
      );
    }
  });

  if (!backfillPeriod) {
    backfillPeriod = 0;
  }

  return {
    options: { backfillPeriod, maxAttempts, queueName, priority },
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
): Pick<ParsedCronItem, "task" | "options" | "payload" | "identifier"> => {
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

function parseCrontabRanges(matches: string[], source: string) {
  const minutes = parseCrontabRange(
    `minutes range in ${source}`,
    matches[1],
    0,
    59,
  );
  const hours = parseCrontabRange(
    `hours range in ${source}`,
    matches[2],
    0,
    23,
  );
  const dates = parseCrontabRange(
    `dates range in ${source}`,
    matches[3],
    1,
    31,
  );
  const months = parseCrontabRange(
    `months range in ${source}`,
    matches[4],
    1,
    12,
  );
  const dows = parseCrontabRange(
    `days of week range in ${source}`,
    matches[5],
    0,
    6,
    true,
  );
  return { minutes, hours, dates, months, dows };
}

/**
 * Parses a line from a crontab file, such as `* * * * * my_task`
 */
export const parseCrontabLine = (
  crontabLine: string,
  lineNumber: number,
): ParsedCronItem => {
  const matches = CRONTAB_LINE_PARTS.exec(crontabLine);
  if (!matches) {
    throw new Error(
      `Could not process line '${lineNumber}' of crontab: '${crontabLine}'`,
    );
  }
  const { minutes, hours, dates, months, dows } = parseCrontabRanges(
    matches,
    `line ${lineNumber} of crontab`,
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

export const parseCrontab = (crontab: string): Array<ParsedCronItem> => {
  const lines = crontab.split(/\r?\n/);
  const items: ParsedCronItem[] = [];
  for (
    let lineNumber = 1, numberOfLines = lines.length;
    lineNumber <= numberOfLines;
    lineNumber++
  ) {
    const line = lines[lineNumber - 1].trim();
    if (line.startsWith("#") || line === "") {
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
      )}' - please use '?id=...' to specify unique identifiers for your cron items`,
    );
  }

  return items;
};

/**
 * Parses a list of `CronItem`s into a list of `ParsedCronItem`s, ensuring the
 * results comply with all the expectations of the `ParsedCronItem` type
 * (including those that cannot be encoded in TypeScript).
 */
export const parseCronItems = (items: CronItem[]): ParsedCronItem[] => {
  return items.map(
    (
      {
        pattern,
        task,
        options = {} as CronItemOptions,
        payload = {},
        identifier = task,
      },
      idx,
    ) => {
      const matches = CRONTAB_TIME_PARTS.exec(pattern);
      if (!matches) {
        throw new Error(
          `Invalid cron pattern '${pattern}' in item ${idx} of parseCronItems call`,
        );
      }
      const { minutes, hours, dates, months, dows } = parseCrontabRanges(
        matches,
        `item ${idx} of parseCronItems call`,
      );
      const item: ParsedCronItem = {
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
      return item;
    },
  );
};
