import {
  EMPTY,
  NOT_CONNECTED,
  PAY_NOT_CONNECTED,
  financeFigures,
  financeSections,
  payMethods,
} from './mock';

/**
 * The two rules a mocked money screen lives or dies by. They are asserted here
 * rather than only in the rendering tests so that the day somebody wires a
 * real total in, the test that fails is the one naming the rule.
 */
describe('the Finance tab is mocked, and says so', () => {
  it('invents no figure at all — every one of them is a dash', () => {
    // A technician who reads a dollar amount off this tab will quote it to a
    // client. A dash cannot be misquoted.
    for (const figure of financeFigures()) {
      expect(figure.value).toBe(EMPTY);
    }
    expect(EMPTY).not.toMatch(/[0-9$]/);
  });

  it('keeps the summary line in the order it was built in', () => {
    // Ours, not theirs. Nothing in the sources records a summary row at the top
    // of Workiz's Finance tab, and the job card was never captured from the
    // live app (`WORKIZ_APP_SCREENS_LIVE.md`, line 11). Pinned so it cannot
    // drift — not claimed as parity.
    expect(financeFigures().map((f) => f.key)).toEqual([
      'invoiceNumber',
      'total',
      'balance',
    ]);
    expect(financeFigures().map((f) => f.label)).toEqual([
      'Invoice',
      'Total',
      'Balance',
    ]);
  });

  it('keeps Workiz’s sections in the order the source actually records', () => {
    // `WORKIZ_MOBILE_APP.md` §1.4: "Finance-вкладка: Job items, Estimates,
    // Invoices, Payments, Documents". That sentence is the whole of the
    // evidence for this tab — the card screen was never captured — and the
    // parity requirement's standard is a source per claim. So the order and
    // the words are that sentence's, and a section the sources never name is
    // not drawn at all: the point of the skeleton is that wiring the API later
    // is a data change, not a redesign, and a skeleton in the wrong order is
    // worse than none.
    expect(financeSections().map((s) => s.label)).toEqual([
      'Job items',
      'Estimates',
      'Invoices',
      'Payments',
      'Documents',
    ]);
  });

  it('says plainly on the tab and on the Pay sheet that this is not connected', () => {
    expect(NOT_CONNECTED).toMatch(/Not connected yet/);
    expect(PAY_NOT_CONNECTED).toMatch(/not connected yet/);
    // One short line each: a warning nobody finishes reading is not a warning.
    expect(NOT_CONNECTED.length).toBeLessThan(160);
    expect(PAY_NOT_CONNECTED.length).toBeLessThan(160);
  });
});

describe('what Pay will do', () => {
  it('leads with cash, which is what these technicians actually take', () => {
    // 43 % of the 34 171 payments taken from the app in this account were cash
    // (WORKIZ_MOBILE_APP.md §1.8). A list that leads with Tap to Pay leads
    // with the method they use least.
    expect(payMethods()[0]!.key).toBe('cash');
    expect(payMethods().map((m) => m.key)).toEqual([
      'cash',
      'check',
      'card',
      'link',
    ]);
  });

  it('describes every method in the future tense — none of them works yet', () => {
    for (const method of payMethods()) {
      expect(method.note).toMatch(/^Will /);
    }
  });

  it('puts no amount on any of it', () => {
    const text = [
      NOT_CONNECTED,
      PAY_NOT_CONNECTED,
      ...payMethods().map((m) => `${m.label} ${m.note}`),
      ...financeSections().map((s) => `${s.label} ${s.empty}`),
    ].join(' ');
    expect(text).not.toMatch(/[$€£]|\d+\.\d{2}/);
  });
});
