import { CronItemOptions, ParsedCronMatch } from "../src";
import { parseCrontab } from "../src/crontab";

// 0...59
const ALL_MINUTES = Array.from(Array(60).keys());
// 0...23
const ALL_HOURS = Array.from(Array(24).keys());
// 1...31
const ALL_DATES = Array.from(Array(32).keys()).slice(1);
// 1...12
const ALL_MONTHS = Array.from(Array(13).keys()).slice(1);
// 0...6
const ALL_DOWS = [0, 1, 2, 3, 4, 5, 6];

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

test("parses crontab file correctly", () => {
  const exampleCrontab = `\
# ┌───────────── UTC minute (0 - 59)
# │ ┌───────────── UTC hour (0 - 23)
# │ │ ┌───────────── UTC day of the month (1 - 31)
# │ │ │ ┌───────────── UTC month (1 - 12)
# │ │ │ │ ┌───────────── UTC day of the week (0 - 6) (Sunday to Saturday)
# │ │ │ │ │ ┌───────────── task (identifier) to schedule
# │ │ │ │ │ │    ┌────────── optional scheduling options
# │ │ │ │ │ │    │     ┌────── optional payload to merge
# │ │ │ │ │ │    │     │
# │ │ │ │ │ │    │     │
# * * * * * task ?opts {payload}

* * * * * simple
0 4 * * * every_day_at_4_am
0 4 * * 0 every_sunday_at_4_am
0 4 * * 7 every_sunday_at_4_am ?id=sunday_7




0 4 * * 2 every_tuesday_at_4_am {isTuesday: true}
*/10,7,56-59 1 1 1 1 one ?id=stuff&fill=4w3d2h1m&max=3&queue=my_queue&priority=3 {myExtraPayload:{stuff:"here with # hash char"}}
    *     *      *       *       *      lots_of_spaces     
* * * * * with_key ?jobKey=my_key
* * * * * with_key_and_mode ?jobKey=my_key&jobKeyMode=preserve_run_at
`;
  const parsed = parseCrontab(exampleCrontab);

  expect(parsed[0].task).toEqual("simple");
  expect(parsed[0].identifier).toEqual("simple");
  const parsedCronMatch0 = (parsed[0].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch0.minutes).toEqual(ALL_MINUTES);
  expect(parsedCronMatch0.hours).toEqual(ALL_HOURS);
  expect(parsedCronMatch0.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch0.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch0.dows).toEqual(ALL_DOWS);
  expect(parsed[0].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[0].payload).toEqual(null);

  expect(parsed[1].task).toEqual("every_day_at_4_am");
  expect(parsed[1].identifier).toEqual("every_day_at_4_am");
  const parsedCronMatch1 = (parsed[1].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch1.minutes).toEqual([0]);
  expect(parsedCronMatch1.hours).toEqual([4]);
  expect(parsedCronMatch1.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch1.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch1.dows).toEqual(ALL_DOWS);
  expect(parsed[1].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[1].payload).toEqual(null);

  expect(parsed[2].task).toEqual("every_sunday_at_4_am");
  expect(parsed[2].identifier).toEqual("every_sunday_at_4_am");
  const parsedCronMatch2 = (parsed[2].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch2.minutes).toEqual([0]);
  expect(parsedCronMatch2.hours).toEqual([4]);
  expect(parsedCronMatch2.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch2.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch2.dows).toEqual([0]);
  expect(parsed[2].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[2].payload).toEqual(null);

  expect(parsed[3].task).toEqual("every_sunday_at_4_am");
  expect(parsed[3].identifier).toEqual("sunday_7");
  const parsedCronMatch3 = (parsed[3].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch3.minutes).toEqual([0]);
  expect(parsedCronMatch3.hours).toEqual([4]);
  expect(parsedCronMatch3.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch3.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch3.dows).toEqual([0]);
  expect(parsed[3].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[3].payload).toEqual(null);

  expect(parsed[4].task).toEqual("every_tuesday_at_4_am");
  expect(parsed[4].identifier).toEqual("every_tuesday_at_4_am");
  const parsedCronMatch4 = (parsed[4].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch4.minutes).toEqual([0]);
  expect(parsedCronMatch4.hours).toEqual([4]);
  expect(parsedCronMatch4.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch4.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch4.dows).toEqual([2]);
  expect(parsed[4].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[4].payload).toEqual({ isTuesday: true });

  // */10,7,56-59 1 1 1 1 one ?id=stuff&fill=4w3d2h1m&max=3&queue=my_queue&priority=3 {myExtraPayload:{stuff:"here with # hash char"}}
  expect(parsed[5].task).toEqual("one");
  expect(parsed[5].identifier).toEqual("stuff");
  const parsedCronMatch5 = (parsed[5].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch5.minutes).toEqual([
    0, 7, 10, 20, 30, 40, 50, 56, 57, 58, 59,
  ]);
  expect(parsedCronMatch5.hours).toEqual([1]);
  expect(parsedCronMatch5.dates).toEqual([1]);
  expect(parsedCronMatch5.months).toEqual([1]);
  expect(parsedCronMatch5.dows).toEqual([1]);
  expect(parsed[5].options).toEqual({
    backfillPeriod: 4 * WEEK + 3 * DAY + 2 * HOUR + 1 * MINUTE,
    maxAttempts: 3,
    priority: 3,
    queueName: "my_queue",
  } as CronItemOptions);
  expect(parsed[5].payload).toEqual({
    myExtraPayload: { stuff: "here with # hash char" },
  });

  expect(parsed[6].task).toEqual("lots_of_spaces");
  expect(parsed[6].identifier).toEqual("lots_of_spaces");
  const parsedCronMatch6 = (parsed[6].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch6.minutes).toEqual(ALL_MINUTES);
  expect(parsedCronMatch6.hours).toEqual(ALL_HOURS);
  expect(parsedCronMatch6.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch6.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch6.dows).toEqual(ALL_DOWS);
  expect(parsed[6].options).toEqual({ backfillPeriod: 0 });
  expect(parsed[6].payload).toEqual(null);

  expect(parsed[7].task).toEqual("with_key");
  expect(parsed[7].identifier).toEqual("with_key");
  const parsedCronMatch7 = (parsed[7].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch7.minutes).toEqual(ALL_MINUTES);
  expect(parsedCronMatch7.hours).toEqual(ALL_HOURS);
  expect(parsedCronMatch7.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch7.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch7.dows).toEqual(ALL_DOWS);
  expect(parsed[7].options).toEqual({
    backfillPeriod: 0,
    jobKey: "my_key",
    jobKeyMode: "replace",
  });
  expect(parsed[7].payload).toEqual(null);

  expect(parsed[8].task).toEqual("with_key_and_mode");
  expect(parsed[8].identifier).toEqual("with_key_and_mode");
  const parsedCronMatch8 = (parsed[8].match as any)
    .parsedCronMatch as ParsedCronMatch;
  expect(parsedCronMatch8.minutes).toEqual(ALL_MINUTES);
  expect(parsedCronMatch8.hours).toEqual(ALL_HOURS);
  expect(parsedCronMatch8.dates).toEqual(ALL_DATES);
  expect(parsedCronMatch8.months).toEqual(ALL_MONTHS);
  expect(parsedCronMatch8.dows).toEqual(ALL_DOWS);
  expect(parsed[8].options).toEqual({
    backfillPeriod: 0,
    jobKey: "my_key",
    jobKeyMode: "preserve_run_at",
  });
  expect(parsed[8].payload).toEqual(null);

  expect(parsed).toMatchSnapshot();
});

describe("gives error on syntax error", () => {
  test("too few parameters", () => {
    expect(() =>
      parseCrontab(`\
* * * * too_few_parameters
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Could not process line '1' of crontab: '* * * * too_few_parameters'"`,
    );
  });

  test("invalid command (two parts)", () => {
    expect(() =>
      parseCrontab(`\
* * * * * two tasks
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Invalid command specification in line 1 of crontab."`,
    );
  });

  test("range exceeded", () => {
    expect(() =>
      parseCrontab(`\
1,60 * * * * out_of_range
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Too large value '60' in minutes range in line 1 of crontab: expected values in the range 0-59."`,
    );
  });

  test("invalid wildcard divisor", () => {
    expect(() =>
      parseCrontab(`\
*/0 * * * * division_by_zero
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Invalid wildcard expression '*/0' in minutes range in line 1 of crontab: divisor '0' expected to be greater than zero"`,
    );
  });

  test("unknown option", () => {
    expect(() =>
      parseCrontab(`\
* * * * * invalid_options ?unknown=3
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Options on line 1 of crontab contains unsupported key 'unknown'; supported keys are: 'id', 'fill', 'max', 'queue', 'jobKey', 'jobKeyMode', 'priority'."`,
    );
  });

  test("invalid JSON5 syntax", () => {
    expect(() =>
      parseCrontab(`\
* * * * * json_syntax_error {invalidJson=true}
`),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Failed to parse JSON5 payload on line 1 of crontab: JSON5: invalid character '=' at 1:13"`,
    );
  });
});
