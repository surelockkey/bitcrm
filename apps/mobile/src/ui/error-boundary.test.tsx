import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppErrorBoundary } from './error-boundary';
import { AppProviders } from '../test/render';

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('kaboom');
  return <Text>all good</Text>;
}

const tree = (explode: boolean, onError?: (e: Error) => void) => (
  <AppProviders>
    <AppErrorBoundary onError={onError}>
      <Boom explode={explode} />
    </AppErrorBoundary>
  </AppProviders>
);

describe('AppErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // React logs the caught error itself; the noise is not the test's business.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it('renders its children when nothing throws', async () => {
    await render(tree(false));
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows the failure and the error text instead of a white screen', async () => {
    await render(tree(true));
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
  });

  it('reports the error to the host so it can be logged', async () => {
    const onError = jest.fn();
    await render(tree(true, onError));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('re-renders the children when the technician taps Try again', async () => {
    const { rerender } = await render(tree(true));
    expect(screen.getByTestId('error-screen')).toBeTruthy();

    // The next render no longer throws — as after a transient failure.
    await rerender(tree(false));
    await fireEvent.press(screen.getByText('Try again'));
    expect(screen.getByText('all good')).toBeTruthy();
  });
});
