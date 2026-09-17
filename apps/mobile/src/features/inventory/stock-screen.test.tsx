import { fireEvent, screen } from '@testing-library/react-native';
import { ApiError } from '../../lib/api/errors';
import { renderScreen } from '../../test/render';
import { StockScreen } from './stock-screen';
import type { UseMyStockResult } from './hooks';
import type { StockRow } from './types';

let mockStock: UseMyStockResult;
const mockRefetch = jest.fn();

jest.mock('./hooks', () => ({
  useMyStock: () => mockStock,
}));

const row = (over: Partial<StockRow> = {}): StockRow => ({
  productId: 'p1',
  name: 'Kwikset deadbolt',
  quantity: 4,
  ...over,
});

const state = (over: Partial<UseMyStockResult> = {}): UseMyStockResult => ({
  container: { id: 'c1', name: 'Van 7', department: 'Locksmith' },
  rows: [],
  summary: { skuCount: 0, totalUnits: 0 },
  unassigned: false,
  isLoading: false,
  isRefetching: false,
  error: undefined,
  stale: false,
  refetch: mockRefetch,
  ...over,
});

beforeEach(() => {
  mockRefetch.mockReset();
  mockStock = state();
});

describe('StockScreen', () => {
  it('leads with the van, then how much is in it', async () => {
    mockStock = state({
      rows: [row(), row({ productId: 'p2', name: 'Brass key blank', quantity: 40 })],
      summary: { skuCount: 2, totalUnits: 44 },
    });
    await renderScreen(<StockScreen />);

    // Same order as the web page: which van, what it holds, then the search.
    expect(screen.getByText('My stock')).toBeTruthy();
    expect(screen.getByText('Van 7')).toBeTruthy();
    expect(screen.getByTestId('stock-summary')).toHaveTextContent(
      'Locksmith · 2 items · 44 on hand',
    );
    expect(screen.getAllByTestId('stock-row')).toHaveLength(2);
  });

  it('reads each row as one thing to a screen reader, quantity and all', async () => {
    mockStock = state({ rows: [row({ quantity: 3 })], summary: { skuCount: 1, totalUnits: 3 } });
    await renderScreen(<StockScreen />);

    const line = screen.getByLabelText('Kwikset deadbolt, 3 on the van');
    /*
     * The label alone is not the test. This renderer finds an
     * `accessibilityLabel` on any element; VoiceOver only reads one on an
     * element that is *accessible*, and the row's quantity is hidden from it
     * by hand — so a row that is not an accessibility element announces the
     * part's name and never the number.
     */
    expect(line.props.accessible).toBe(true);
  });

  it('narrows the list as the technician types, and offers a way back', async () => {
    mockStock = state({
      rows: [row(), row({ productId: 'p2', name: 'Brass key blank' })],
      summary: { skuCount: 2, totalUnits: 8 },
    });
    await renderScreen(<StockScreen />);

    await fireEvent.changeText(screen.getByTestId('stock-search'), 'brass');
    expect(screen.getAllByTestId('stock-row')).toHaveLength(1);
    expect(screen.getByText('Brass key blank')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('stock-search'), 'nothing like this');
    expect(screen.queryByTestId('stock-row')).toBeNull();
    expect(screen.getByTestId('stock-no-match')).toBeTruthy();

    await fireEvent.press(screen.getByText('Clear search'));
    expect(screen.getAllByTestId('stock-row')).toHaveLength(2);
  });

  it('tells a technician with no van who can give them one', async () => {
    mockStock = state({ container: undefined, unassigned: true });
    await renderScreen(<StockScreen />);

    expect(screen.getByTestId('stock-unassigned')).toBeTruthy();
    expect(screen.getByText(/Ask the office/)).toBeTruthy();
    // Nothing here for them to retry — retrying would fail the same way.
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('lets them look again once the office has put them on a van', async () => {
    /*
     * The only empty state on this screen that the server changes while the
     * technician is looking at it. The tab stays mounted and nothing refetches
     * on a tab tap, so without a control here "No van assigned to you yet"
     * outlives the assignment — until the app is killed.
     */
    mockStock = state({ container: undefined, unassigned: true });
    await renderScreen(<StockScreen />);

    await fireEvent.press(screen.getByText('Check again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('distinguishes an empty van from a van it could not read', async () => {
    await renderScreen(<StockScreen />);
    expect(screen.getByTestId('stock-empty')).toBeTruthy();
    expect(screen.getByText(/office puts stock on it with a transfer/)).toBeTruthy();
  });

  it('says "No signal" rather than blaming the server when there is none', async () => {
    mockStock = state({ error: new ApiError(0, 'Unable to reach the server.') });
    await renderScreen(<StockScreen />);

    expect(screen.getByTestId('stock-error')).toBeTruthy();
    expect(screen.getByText('No signal')).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('keeps the cached list up when the refresh fails, and admits it is old', async () => {
    mockStock = state({
      rows: [row()],
      summary: { skuCount: 1, totalUnits: 4 },
      error: new ApiError(0, 'Unable to reach the server.'),
      stale: true,
    });
    await renderScreen(<StockScreen />);

    expect(screen.getAllByTestId('stock-row')).toHaveLength(1);
    expect(screen.getByText(/last list this phone downloaded/)).toBeTruthy();
    expect(screen.queryByTestId('stock-error')).toBeNull();
  });

  it('shows the van’s name while the list is still coming', async () => {
    mockStock = state({ isLoading: true });
    await renderScreen(<StockScreen />);

    expect(screen.getByText('Van 7')).toBeTruthy();
    expect(screen.queryByTestId('stock-empty')).toBeNull();
  });

  it('renders in the dark theme a night call is read in', async () => {
    mockStock = state({ rows: [row()], summary: { skuCount: 1, totalUnits: 4 } });
    await renderScreen(<StockScreen />, { scheme: 'dark' });

    expect(screen.getByTestId('stock-screen')).toBeTruthy();
    expect(screen.getByText('Kwikset deadbolt')).toBeTruthy();
  });
});
