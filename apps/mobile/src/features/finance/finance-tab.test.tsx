import { screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { FinanceTab } from './components/FinanceTab';
import { PaySheet } from './components/PaySheet';
import { financeSections } from './mock';

describe('FinanceTab', () => {
  it.each(['light', 'dark'] as const)('draws in the %s theme', async (scheme) => {
    await renderScreen(<FinanceTab />, { scheme });
    expect(screen.getByTestId('finance-tab')).toBeTruthy();
  });

  it('puts the honest line above everything on the tab', async () => {
    await renderScreen(<FinanceTab />);
    expect(screen.getByTestId('finance-not-connected')).toBeTruthy();
    expect(screen.getByText(/nothing on this tab is live/)).toBeTruthy();
  });

  it('draws every one of Workiz’s sections, so the shape is right now', async () => {
    await renderScreen(<FinanceTab />);
    for (const section of financeSections()) {
      expect(screen.getByTestId(`finance-section-${section.key}`)).toBeTruthy();
      expect(screen.getByText(section.label)).toBeTruthy();
    }
  });

  it('shows dashes where the figures go, never a zero', async () => {
    // Zero is a fact — "this job owes nothing". A dash is the absence of one,
    // which is the truth while nothing is connected.
    await renderScreen(<FinanceTab />);
    for (const key of ['invoiceNumber', 'total', 'balance']) {
      expect(screen.getByTestId(`finance-figure-${key}`).props.children).toBe('—');
    }
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('0.00')).toBeNull();
  });

  it('offers nothing to tap — a dead row is worse than an absent one', async () => {
    await renderScreen(<FinanceTab />);
    for (const section of financeSections()) {
      const row = screen.getByTestId(`finance-section-${section.key}`);
      expect(row.props.accessibilityRole).toBeUndefined();
      expect(row.props.onClick).toBeUndefined();
    }
  });
});

describe('PaySheet', () => {
  it('is not on screen until Pay is pressed', async () => {
    await renderScreen(<PaySheet visible={false} onClose={jest.fn()} />);
    expect(screen.queryByTestId('pay-sheet')).toBeNull();
  });

  it.each(['light', 'dark'] as const)(
    'says in the %s theme that payment is not connected',
    async (scheme) => {
      await renderScreen(<PaySheet visible onClose={jest.fn()} />, { scheme });
      expect(screen.getByTestId('pay-not-connected')).toBeTruthy();
      expect(screen.getByText(/Nothing here charges anybody/)).toBeTruthy();
    },
  );

  it('lists the methods as text, so nothing on it can look pressable', async () => {
    await renderScreen(<PaySheet visible onClose={jest.fn()} />);
    for (const key of ['cash', 'check', 'card', 'link']) {
      const row = screen.getByTestId(`pay-method-${key}`);
      expect(row.props.accessibilityRole).toBeUndefined();
    }
    // The only control on the sheet is the one that leaves it.
    expect(screen.getByTestId('pay-sheet-close')).toBeTruthy();
  });

  it('tells the technician what to do instead, not only what it cannot do', async () => {
    await renderScreen(<PaySheet visible onClose={jest.fn()} />);
    expect(screen.getByText(/Collect as you do today and tell the office/)).toBeTruthy();
  });
});
