import { fillPage } from 'src/common/utils/fill-page';

/**
 * Коли запит, що переповнив сторінку, дочитував розділ до кінця, сторінка
 * поверталась цілою і без курсора: `GET /containers?limit=50` віддавав усі
 * 88 фургонів, і в UI "Rows per page 50" показувало "1–88 of 88" з вимкненою
 * кнопкою "Далі". Тепер це обрізає сам `scanPage` (shared); `fillPage` лише
 * вимагає `keyOf` і вміє читати великими порціями (`readRows`).
 */
describe('fillPage', () => {
  type Row = { PK: string; SK: string };
  const row = (n: number): Row => ({ PK: `CONTAINER#v${n}`, SK: 'METADATA' });
  const keyOf = (r: Row) => ({ PK: r.PK, SK: r.SK });

  it('cuts the page and hands back a cursor at the last row kept, even when the read ended the partition', async () => {
    const read = jest.fn().mockResolvedValue({ Items: [row(1), row(2), row(3)], LastEvaluatedKey: undefined });

    const page = await fillPage(read, 2, { keyOf });

    expect(page.items).toEqual([row(1), row(2)]);
    expect(page.lastKey).toEqual({ PK: 'CONTAINER#v2', SK: 'METADATA' });
  });

  it('a page that fits exactly at the end of the partition has no cursor', async () => {
    const read = jest.fn().mockResolvedValue({ Items: [row(1), row(2)] });

    const page = await fillPage(read, 2, { keyOf });

    expect(page.items).toHaveLength(2);
    expect(page.lastKey).toBeUndefined();
  });

  it('a short last page has no cursor', async () => {
    const read = jest.fn().mockResolvedValue({ Items: [row(1)] });

    expect(await fillPage(read, 5, { keyOf })).toEqual({ items: [row(1)], lastKey: undefined });
  });

  it('still fills across reads and resumes from the start key', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({ Items: [row(4)], LastEvaluatedKey: { PK: 'X', SK: 'Y' } })
      .mockResolvedValueOnce({ Items: [row(5), row(6)] });

    const page = await fillPage(read, 2, { keyOf, startKey: { PK: 'CONTAINER#v3', SK: 'METADATA' } });

    expect(read.mock.calls[0][0].ExclusiveStartKey).toEqual({ PK: 'CONTAINER#v3', SK: 'METADATA' });
    expect(page.items).toEqual([row(4), row(5)]);
    expect(page.lastKey).toEqual(keyOf(row(5)));
  });

  // Партиції товарів (Price Book ~16 тис., категорія "Uncategorized" ~13 тис.)
  // читаються по 1 МБ: 10 × limit рядків за читання — це 100 рядків при
  // limit=10, і рідкісний пошук вичерпував бюджет, не дочитавши розділ.
  it('asks every read for at least `readRows` rows, whatever the page size', async () => {
    const read = jest.fn().mockResolvedValue({ Items: [] });

    await fillPage(read, 10, { keyOf, readRows: 1000 });
    await fillPage(read, 500, { keyOf, readRows: 1000 });

    expect(read.mock.calls[0][0].Limit).toBe(1000);
    // A page whose own read is larger keeps it.
    expect(read.mock.calls[1][0].Limit).toBe(5000);
  });

  it('passes the read budget through', async () => {
    const read = jest.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: { PK: 'X', SK: 'Y' } });

    const page = await fillPage(read, 2, { keyOf, maxReads: 3 });

    expect(read).toHaveBeenCalledTimes(3);
    expect(page).toEqual({ items: [], lastKey: { PK: 'X', SK: 'Y' } });
  });
});
