/**
 * How long to wait between polling for jobs.
 *
 * Note: this does NOT need to be short, because we use LISTEN/NOTIFY to be
 * notified when new jobs are added - this is just used for jobs scheduled in
 * the future, retried jobs, and in the case where LISTEN/NOTIFY fails for
 * whatever reason.
 */
export const POLL_INTERVAL = 2000;

/**
 * How many errors in a row can we get fetching a job before we raise a higher
 * exception?
 */
export const MAX_CONTIGUOUS_ERRORS = 10;

/**
 * Number of jobs to run concurrently
 */
export const CONCURRENT_JOBS = 1;
/**
 * Logging level for logger, could be set as per environment
 * https://github.com/winstonjs/winston/blob/master/README.md#logging-levels
 */
export const LOGGER_LEVEL = "debug";
