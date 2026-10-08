import {
  DASHBOARD_PRESETS,
  DASHBOARD_TIMEZONE,
  dashboardDay,
  dashboardPresetWindow,
  dashboardWindow,
  msUntilDailyAt,
} from '@bitcrm/types';

/**
 * Вікна дашборда рахуються в часовому поясі акаунта, а не браузера й не
 * сервера: інакше знімок, що крон порахував о третій ночі, мав би інший ключ,
 * ніж вікно, про яке питає браузер у Далласі, і кеш промахувався б.
 */
describe('dashboard time', () => {
  it('the account is on Eastern time — Connecticut', () => {
    expect(DASHBOARD_TIMEZONE).toBe('America/New_York');
  });

  describe('dashboardDay', () => {
    it('is the calendar day in New York, not in UTC', () => {
      // 02:30 UTC on the 29th is still 22:30 on the 28th in New York.
      expect(dashboardDay(new Date('2026-09-29T02:30:00Z'))).toBe('2026-09-28');
      expect(dashboardDay(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-29');
    });
  });

  describe('dashboardWindow', () => {
    it('reaches N days back and includes both ends, as Workiz does', () => {
      expect(dashboardWindow(14, new Date('2026-09-28T15:00:00Z'))).toEqual({ from: '2026-09-14', to: '2026-09-28' });
    });

    it('crosses a month', () => {
      expect(dashboardWindow(30, new Date('2026-09-28T15:00:00Z'))).toEqual({ from: '2026-08-29', to: '2026-09-28' });
    });

    it('ends on the New York day even late in the evening', () => {
      expect(dashboardWindow(7, new Date('2026-09-29T02:30:00Z'))).toEqual({ from: '2026-09-21', to: '2026-09-28' });
    });
  });

  /**
   * Workiz Home's range picker: "This week (Mon-Today)", "Last 14 days", "This
   * month", "Last 3 months" (its main.js `eEl`; the dates as its own picker
   * defines them, the 14 days as its chart draws them — both ends included).
   * Oct 8 2026 is a Thursday.
   */
  describe('dashboardPresetWindow', () => {
    const thu = new Date('2026-10-08T15:00:00Z');

    it('this week runs from Monday to today', () => {
      expect(dashboardPresetWindow('this_week', thu)).toEqual({ from: '2026-10-05', to: '2026-10-08' });
    });

    it('this week on a Monday is just Monday, and on a Sunday reaches back to Monday', () => {
      expect(dashboardPresetWindow('this_week', new Date('2026-10-05T15:00:00Z'))).toEqual({
        from: '2026-10-05',
        to: '2026-10-05',
      });
      expect(dashboardPresetWindow('this_week', new Date('2026-10-11T15:00:00Z'))).toEqual({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    });

    it('last 14 days is the chart Workiz draws: fifteen days, both ends', () => {
      expect(dashboardPresetWindow('last_14_days', thu)).toEqual(dashboardWindow(14, thu));
    });

    it('this month runs from the 1st to today', () => {
      expect(dashboardPresetWindow('this_month', thu)).toEqual({ from: '2026-10-01', to: '2026-10-08' });
    });

    it('last 3 months are the three whole months before this one — never more than 92 days', () => {
      expect(dashboardPresetWindow('last_three', thu)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
      expect(dashboardPresetWindow('last_three', new Date('2027-01-15T15:00:00Z'))).toEqual({
        from: '2026-10-01',
        to: '2026-12-31',
      });
    });

    it('reads the day in New York', () => {
      // 02:30 UTC on Nov 1 is still Oct 31 in New York.
      expect(dashboardPresetWindow('this_month', new Date('2026-11-01T02:30:00Z'))).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });

    it('offers the four presets in Workiz order', () => {
      expect(DASHBOARD_PRESETS).toEqual(['this_week', 'last_14_days', 'this_month', 'last_three']);
    });
  });

  describe('msUntilDailyAt — the next 3 AM in New York', () => {
    const h = 3_600_000;

    it('later the same night when it is not yet 3 AM there', () => {
      // 02:00 EDT
      expect(msUntilDailyAt(new Date('2026-09-28T06:00:00Z'), 3)).toBe(1 * h);
    });

    it('tomorrow once 3 AM has passed', () => {
      // 08:00 EDT → 03:00 EDT next day
      expect(msUntilDailyAt(new Date('2026-09-28T12:00:00Z'), 3)).toBe(19 * h);
    });

    it('exactly at 3 AM means the next one, not now', () => {
      expect(msUntilDailyAt(new Date('2026-09-28T07:00:00Z'), 3)).toBe(24 * h);
    });

    it('follows the clocks back in November: 3 AM EST is 08:00 UTC', () => {
      // 08:00 EDT on Oct 31 → 03:00 EST on Nov 1 = 08:00 UTC: 20 hours, not 19.
      expect(msUntilDailyAt(new Date('2026-10-31T12:00:00Z'), 3)).toBe(20 * h);
    });

    it('and forward in March: 3 AM EDT is 07:00 UTC', () => {
      // 08:00 EST on Sat Mar 13 → 03:00 EDT on Sun Mar 14 (the second Sunday) = 07:00 UTC.
      expect(msUntilDailyAt(new Date('2027-03-13T13:00:00Z'), 3)).toBe(18 * h);
    });
  });
});
