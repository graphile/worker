import * as JSON5 from "json5";
import { parse } from "querystring";

import {
  CRONTAB_COMMAND,
  CRONTAB_LINE_PARTS,
  CRONTAB_OPTIONS_BACKFILL,
  CRONTAB_OPTIONS_ID,
  CRONTAB_OPTIONS_MAX,
  CRONTAB_OPTIONS_PRIORITY,
  CRONTAB_OPTIONS_QUEUE,
  PERIOD_DURATIONS,
  TIMEPHRASE_PART,
} from "./cronConstants";
import { createCronMatcher, createCronMatcherFromRanges } from "./cronMatcher";
import {
  $$isParsed,
  CronItem,
  CronItemOptions,
  ParsedCronItem,
} from "./interfaces";

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
    const periodDuration =
      PERIOD_DURATIONS[period as keyof typeof PERIOD_DURATIONS] || 0;
    milliseconds += parseInt(quantity, 10) * periodDuration;
    remaining = remaining.slice(wholeMatch.length);
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
): Record<string, unknown> | null => {
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
  const match = createCronMatcherFromRanges(
    matches,
    `line ${lineNumber} of crontab`,
  );
  const { task, options, payload, identifier } = parseCrontabCommand(
    lineNumber,
    matches[6],
  );

  return {
    [$$isParsed]: true,
    match,
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
  return items.map((item, idx) =>
    parseCronItem(item, `item ${idx} of parseCronItems call`),
  );
};

/**
 * Parses an individual `CronItem` into a `ParsedCronItem`, ensuring the
 * results comply with all the expectations of the `ParsedCronItem` type
 * (including those that cannot be encoded in TypeScript).
 */
export const parseCronItem = (
  cronItem: CronItem,
  source: string = "parseCronItem call",
): ParsedCronItem => {
  const {
    match: rawMatch,
    task,
    options = {} as CronItemOptions,
    payload = {},
    identifier = task,
  } = cronItem;
  if (cronItem.pattern) {
    throw new Error("Please rename the 'pattern' property to 'match'");
  }
  const match =
    typeof rawMatch === "string"
      ? createCronMatcher(rawMatch, source)
      : rawMatch;
  if (typeof match !== "function") {
    throw new Error("Invalid 'match' configuration");
  }
  return {
    [$$isParsed]: true,
    match,
    task,
    options,
    payload,
    identifier,
  };
};
