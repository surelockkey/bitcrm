import { useIsFocused } from 'expo-router';
import { ChatScreen } from '../../../src/features/messaging/chat-screen';

/**
 * The Messages tab — the technician's thread with the office.
 *
 * Focus is passed down rather than read inside the screen: it is what decides
 * whether the thread is polled, and a tab that stays mounted behind "My jobs"
 * must not keep asking the server for a conversation nobody is reading.
 */
export default function ChatTab() {
  return <ChatScreen live={useIsFocused()} />;
}
