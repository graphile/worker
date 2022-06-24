import { createCronMatcher } from "../src/cronMatcher";

describe("matches datetime", () => {
  const makeMatcher = (pattern: string) => createCronMatcher(pattern, "test");
  const _0_0_1_1_0 = { min: 0, hour: 0, date: 1, month: 1, dow: 0 };
  const _0_0_1_1_5 = { ..._0_0_1_1_0, dow: 5 };
  const _0_0_1_1_4 = { ..._0_0_1_1_0, dow: 4 };
  const _0_15_1_7_0 = { ..._0_0_1_1_0, hour: 15, month: 7 };
  const _0_15_4_7_2 = { ..._0_0_1_1_0, hour: 15, date: 4, month: 7, dow: 2 };
  const _0_15_4_7_5 = { ..._0_0_1_1_0, hour: 15, date: 4, month: 7, dow: 5 };
  const _6_15_4_7_5 = { min: 6, hour: 15, date: 4, month: 7, dow: 5 };

  test("every minute", () => {
    const match = makeMatcher("* * * * *");
    expect(match(_0_0_1_1_0)).toBeTruthy();
    expect(match(_0_0_1_1_5)).toBeTruthy();
    expect(match(_0_0_1_1_4)).toBeTruthy();
    expect(match(_0_15_1_7_0)).toBeTruthy();
    expect(match(_0_15_4_7_2)).toBeTruthy();
    expect(match(_0_15_4_7_5)).toBeTruthy();
    expect(match(_6_15_4_7_5)).toBeTruthy();
  });
  test("dow range", () => {
    const match = makeMatcher("* * * * 5-6");
    expect(match(_0_0_1_1_0)).toBeFalsy();
    expect(match(_0_0_1_1_5)).toBeTruthy();
    expect(match(_0_0_1_1_4)).toBeFalsy();
    expect(match(_0_15_1_7_0)).toBeFalsy();
    expect(match(_0_15_4_7_2)).toBeFalsy();
    expect(match(_0_15_4_7_5)).toBeTruthy();
    expect(match(_6_15_4_7_5)).toBeTruthy();
  });
  test("dow and date range", () => {
    const match = makeMatcher("0-5 15 3-4 7 0-2");
    expect(match(_0_0_1_1_0)).toBeFalsy();
    expect(match(_0_0_1_1_5)).toBeFalsy();
    expect(match(_0_0_1_1_4)).toBeFalsy();
    expect(match(_0_15_1_7_0)).toBeTruthy();
    expect(match(_0_15_4_7_2)).toBeTruthy();
    expect(match(_0_15_4_7_5)).toBeTruthy();
    expect(match(_6_15_4_7_5)).toBeFalsy();
  });
});
