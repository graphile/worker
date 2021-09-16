/** One second in milliseconds */
export const SECOND = 1000;
/** One minute in milliseconds */
export const MINUTE = 60 * SECOND;
/** One hour in milliseconds */
export const HOUR = 60 * MINUTE;
/** One day in milliseconds */
export const DAY = 24 * HOUR;
/** One week in milliseconds */
export const WEEK = 7 * DAY;

// A (non-comment, non-empty) line in the crontab file
/** Separates crontab line into the minute, hour, day of month, month, day of week and command parts. */
export const CRONTAB_LINE_PARTS = /^([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+(.*)$/;
/** Just the time expression from CRONTAB_LINE_PARTS */
export const CRONTAB_TIME_PARTS = /^([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)\s+([0-9*/,-]+)$/;

// Crontab ranges from the minute, hour, day of month, month and day of week parts of the crontab line
/** Matches an explicit numeric value */
export const CRONTAB_NUMBER = /^([0-9]+)$/;
/** Matches a range of numeric values */
export const CRONTAB_RANGE = /^([0-9]+)-([0-9]+)$/;
/** Matches a numeric wildcard, optionally with a divisor */
export const CRONTAB_WILDCARD = /^\*(?:\/([0-9]+))?$/;

// The command from the crontab line
/** Splits the command from the crontab line into the task, options and payload. */
export const CRONTAB_COMMAND = /^([_a-zA-Z][_a-zA-Z0-9:_-]*)(?:\s+\?([^\s]+))?(?:\s+(\{.*\}))?$/;

// Crontab command options
/** Matches the id=UID option, capturing the unique identifier */
export const CRONTAB_OPTIONS_ID = /^([_a-zA-Z][-_a-zA-Z0-9]*)$/;
/** Matches the fill=t option, capturing the time phrase  */
export const CRONTAB_OPTIONS_BACKFILL = /^((?:[0-9]+[smhdw])+)$/;
/** Matches the max=n option, capturing the max executions number */
export const CRONTAB_OPTIONS_MAX = /^([0-9]+)$/;
/** Matches the queue=name option, capturing the queue name */
export const CRONTAB_OPTIONS_QUEUE = /^([-a-zA-Z0-9_:]+)$/;
/** Matches the priority=n option, capturing the priority value */
export const CRONTAB_OPTIONS_PRIORITY = /^(-?[0-9]+)$/;

/** Matches the quantity and period string at the beginning of a timephrase */
export const TIMEPHRASE_PART = /^([0-9]+)([smhdw])/;
export const PERIOD_DURATIONS = {
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: WEEK,
};
