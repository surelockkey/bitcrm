import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../test/render';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'timeline', label: 'Timeline', hint: 'Your day as a list' },
  { value: 'day', label: 'Day', hint: 'Your day hour by hour' },
] as const;

const render = (value: 'timeline' | 'day', onChange = jest.fn(), scheme?: 'light' | 'dark') =>
  renderScreen(
    <SegmentedControl
      testID="mode"
      accessibilityLabel="Schedule view"
      options={options}
      value={value}
      onChange={onChange}
    />,
    scheme ? { scheme } : undefined,
  );

describe('SegmentedControl', () => {
  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await render('timeline', jest.fn(), scheme);
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
  });

  it('chooses the one that was pressed', async () => {
    const onChange = jest.fn();
    await render('timeline', onChange);
    await fireEvent.press(screen.getByTestId('mode-day'));
    expect(onChange).toHaveBeenCalledWith('day');
  });

  /**
   * Colour is never the only carrier: the fill says which is chosen to a
   * sighted technician, and `selected` says it to everyone else.
   */
  it('announces which one is chosen, not only fills it', async () => {
    await render('day');
    expect(screen.getByTestId('mode-day').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('mode-timeline').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('is a tab list, so a screen reader knows the content below swaps', async () => {
    await render('timeline');
    expect(screen.getByLabelText('Schedule view')).toBeTruthy();
    expect(screen.getByTestId('mode-timeline').props.accessibilityRole).toBe('tab');
  });
});
