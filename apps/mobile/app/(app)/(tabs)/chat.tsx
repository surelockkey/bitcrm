/**
 * The Messages tab.
 *
 * One list with four filters — `All` · `Requests` · `Clients` · `Team`, where
 * Team *is* the office — the way Workiz's own app does it on a phone
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §5). It replaces the single thread
 * with the office that used to be this tab; that thread is now the top row of
 * the list, and every other way into it — a job's way in at
 * `/chat/<dealId>`, a tapped notification — still opens the screen it always
 * did.
 *
 * What the tab *is* lives in the feature folder, so the tab bar and the screen
 * can be changed apart.
 */
export { MessagesTab as default } from '../../../src/features/messaging/messages-tab';
