/**
 * Every number the rules engine uses, with the article it comes from.
 * All durations in minutes.
 *
 * Sources (SPEC §4; to be confirmed against the consolidated texts before
 * release): Regulation (EC) 561/2006 as amended by Regulation (EU) 2020/1054
 * (Mobility Package); Directive 2002/15/EC (working time of mobile workers).
 */
export const HOUR = 60;
export const DAY = 24 * HOUR;

export const LIMITS = {
  // ── 561/2006 art. 7 — breaks ─────────────────────────────────────────────
  /** Driving after which a break is due. */
  continuousDriving: 4.5 * HOUR,
  /** The full break. */
  break: 45,
  /** A split break: at least 15 min, then at least 30 min (this order only). */
  splitBreakFirst: 15,
  splitBreakSecond: 30,

  // ── 561/2006 art. 6 — driving times ──────────────────────────────────────
  /** Daily driving time (between two daily rests, or a daily and a weekly rest). */
  dailyDriving: 9 * HOUR,
  /** Extended daily driving time, at most `extendedDaysPerWeek` times in a fixed week. */
  dailyDrivingExtended: 10 * HOUR,
  extendedDaysPerWeek: 2,
  /** Weekly driving time (fixed week, Monday 00:00 – Sunday 24:00). */
  weeklyDriving: 56 * HOUR,
  /** Driving in any two consecutive fixed weeks. */
  fortnightDriving: 90 * HOUR,

  // ── 561/2006 art. 4(g), art. 8(1)–(2), (4) — daily rest ──────────────────
  dailyRestRegular: 11 * HOUR,
  dailyRestReduced: 9 * HOUR,
  /** A regular daily rest may be split: at least 3 h, then at least 9 h (this order only). */
  splitDailyRestFirst: 3 * HOUR,
  splitDailyRestSecond: 9 * HOUR,
  /** At most three reduced daily rests between two weekly rests. */
  reducedDailyRestsBetweenWeekly: 3,
  /** A new daily rest must be taken within 24 h after the end of the previous daily or weekly rest. */
  dailyRestWindow: DAY,

  // ── 561/2006 art. 4(h), art. 8(6)–(7) — weekly rest ──────────────────────
  weeklyRestRegular: 45 * HOUR,
  weeklyRestReduced: 24 * HOUR,
  /** A weekly rest starts no later than at the end of six 24-hour periods after the previous one. */
  weeklyRestLatestStartAfter: 6 * DAY,
  /** Compensation for a reduction is attached to another rest of at least 9 h. */
  compensationAttachedToRestOfAtLeast: 9 * HOUR,
  /** ... and taken before the end of the third week following the week of the reduction. */
  compensationWeeksAfter: 3,
  /**
   * Exception (art. 8(6), third subparagraph, international transport):
   * two consecutive reduced weekly rests outside the Member State of
   * establishment, if in any four consecutive weeks there are at least four
   * weekly rests, at least two of them regular.
   */
  exceptionWindow: 28 * DAY,
  exceptionRestsInWindow: 4,
  exceptionRegularRestsInWindow: 2,

  // ── 561/2006 art. 8(8a) — return home (Mobility Package) ─────────────────
  /** The company enables the return home within each period of 4 consecutive weeks... */
  homeReturnPeriod: 28 * DAY,
  /** ... or 3 weeks after two consecutive reduced weekly rests. */
  homeReturnPeriodAfterTwoReduced: 21 * DAY,
  // The 8-week vehicle return obligation (art. 5(1)(b) of Reg. 1071/2009 as
  // amended) was annulled by the CJEU on 4 October 2024 (joined cases C-541/20
  // to C-555/20) — not enforced.

  // ── 2002/15 art. 5 — breaks in working time ──────────────────────────────
  /** No more than 6 consecutive hours of work without a break. */
  wtdWorkBeforeBreak: 6 * HOUR,
  /** Total breaks when work totals more than 6 h ... */
  wtdBreakOver6h: 30,
  /** ... and more than 9 h. */
  wtdLongDay: 9 * HOUR,
  wtdBreakOver9h: 45,
  /** Breaks may be split into parts of at least 15 minutes. */
  wtdBreakPartMin: 15,
} as const;
