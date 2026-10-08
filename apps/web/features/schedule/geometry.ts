/**
 * The Workiz Schedule's measurements (DHTMLX "terrace" skin as Workiz styles
 * it), from the pg_schedule_wz_* captures. Pixels unless said otherwise.
 */

/* Day / Week (pg_schedule_wz_01_day_*, 04_week_*). */
/** One hour row of the time grid (`.dhx_scale_hour`). */
export const HOUR_PX = 88;
export const PX_PER_MIN = HOUR_PX / 60;
/** The hour gutter (`.dhx_scale_holder` 50px + its 1px rule). */
export const GUTTER_PX = 50;
/** The day header over the columns: "Fri" over the date. */
export const DAY_HEADER_PX = 65;
/** The all-day / multi-day strip: bars 19px tall on a 24px pitch, 2px down, 5px spare. */
export const STRIP_BAR_PX = 19;
export const STRIP_PITCH_PX = 24;
export const stripHeight = (lanes: number) => (lanes ? lanes * STRIP_PITCH_PX + 5 : 0);
/** Below this many pixels a job would get in a crowded column, jobs cascade 2px apart instead. */
export const MIN_SPLIT_PX = 10;
export const CASCADE_PX = 2;

/* Month (05_month). */
export const MONTH_HEADER_PX = 30;
export const MONTH_ROW_PX = 166;
export const MONTH_HEAD_PX = 21;
export const MONTH_LINE_PX = 20;
export const MONTH_PITCH_PX = 24;
/** Rows a day shows before "View more(N)". */
export const MONTH_LANES = 5;

/* Timeline / Timeline Week (06_timeline*, 07_timeline_week*). */
export const TL_HOUR_PX = 70;
export const TL_PX_PER_MIN = TL_HOUR_PX / 60;
export const TL_SECTION_PX = 200;
export const TLW_SECTION_PX = 150;
export const TL_HEADER_PX = 31;
export const TLW_HEADER_PX = 66;
export const TL_ROW_MIN_PX = 75;
export const TL_BAR_PX = 22;
export const TL_LANE_PX = 23;
export const timelineRowHeight = (lanes: number) => Math.max(TL_ROW_MIN_PX, 2 + lanes * TL_LANE_PX + 4);

/* Grid rules. */
/** `.dhx_scale_holder` / `.dhx_scale_hour` rules — #cecece. */
export const RULE = "#cecece";
/** databg.png: a #ebebeb line at the quarter hours, #cecece at the half and full hours. */
export const QUARTER_LINES =
  "repeating-linear-gradient(to bottom, transparent 0 21px, #ebebeb 21px 22px, transparent 22px 43px, #cecece 43px 44px)";
/** The Done look: grey stripes over the colour (`.cal_status_Done`). */
export const DONE_STRIPES =
  "linear-gradient(45deg, #d6d6d6 25%, #cccccc 25%, #cccccc 50%, #d6d6d6 50%, #d6d6d6 75%, #cccccc 75%, #cccccc 100%)";
