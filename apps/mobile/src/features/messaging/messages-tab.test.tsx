import { screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import type { InboxScreenProps } from './inbox-screen';
import type { InboxRow } from './inbox-lib';
import { MessagesTab } from './messages-tab';
import ChatTabRoute from '../../../app/(app)/(tabs)/chat';

const mockPush = jest.fn();
let lastProps: InboxScreenProps;

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useIsFocused: () => true,
}));

jest.mock('./inbox-screen', () => ({
  InboxScreen: (props: InboxScreenProps) => {
    lastProps = props;
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText testID="inbox-stand-in">Messages</RNText>;
  },
}));

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'conv-client',
  kind: 'client',
  category: 'clients',
  audience: 'client',
  title: 'Ada Byron',
  tag: 'Client',
  preview: 'The gate code did not work',
  time: '12:10 PM',
  unread: true,
  unreadCount: 1,
  activityAt: '2026-09-16T12:10:00.000Z',
  ...over,
});

describe('the Messages tab', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * The whole point of the wave: `/chat` is the one list with four filters, not
   * the single thread with the office. A tab route left pointing at the old
   * screen would ship every line of this feature as code nobody can reach.
   */
  it('is what the tab route mounts', () => {
    expect(ChatTabRoute).toBe(MessagesTab);
  });

  it('draws the list', async () => {
    await renderScreen(<MessagesTab />);
    expect(screen.getByTestId('inbox-stand-in')).toBeTruthy();
  });

  // Pushed over the tab bar, so Back returns to the list at the chip and the
  // scroll position the technician left it at.
  it('opens a row as a pushed thread, whatever kind it is', async () => {
    await renderScreen(<MessagesTab />);

    lastProps.onOpenThread(row());
    expect(mockPush).toHaveBeenCalledWith('/chat/conversation/conv-client');

    lastProps.onOpenThread(row({ id: 'conv-team', kind: 'team', audience: 'office' }));
    expect(mockPush).toHaveBeenCalledWith('/chat/conversation/conv-team');
  });
});
