import { DASHBOARD_TIMEZONE, dashboardDay, dashboardWindow, msUntilDailyAt } from '@bitcrm/types';

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
