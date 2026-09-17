import { Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../test/render';
import { DrawerHost, DrawerRow, MenuButton, useDrawer, type MenuMark } from './Drawer';

function Menu() {
  const { close } = useDrawer();
  return (
    <>
      <Text>Timesheets</Text>
      <DrawerRow testID="menu-row" label="Jobs" hint="Every job" onPress={close} />
    </>
  );
}

function Shell({ mark }: { mark?: MenuMark } = {}) {
  return (
    <DrawerHost menu={<Menu />}>
      <MenuButton mark={mark} />
      <Text>Behind the menu</Text>
    </DrawerHost>
  );
}

const waiting: MenuMark = {
  label: 'Menu, something is waiting to send',
  tone: 'notice',
};
const failed: MenuMark = {
  label: 'Menu, something could not be sent',
  tone: 'danger',
};

const open = async () => fireEvent.press(screen.getByTestId('open-menu'));

describe('DrawerHost', () => {
  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await renderScreen(<Shell />, { scheme });
    expect(screen.getByText('Behind the menu')).toBeTruthy();
    // Shut until asked for: the menu is not part of the page behind it.
    expect(screen.queryByTestId('menu-row')).toBeNull();
  });

  it('opens from the burger and shows the menu', async () => {
    await renderScreen(<Shell />);
    await open();
    expect(screen.getByTestId('drawer-panel')).toBeTruthy();
    expect(screen.getByText('Timesheets')).toBeTruthy();
  });

  it.each([
    ['the Close button', 'drawer-close'],
    ['the dead half of the screen', 'drawer-scrim'],
  ])('closes from %s', async (_name, testID) => {
    await renderScreen(<Shell />);
    await open();
    await fireEvent.press(screen.getByTestId(testID));
    expect(screen.queryByText('Timesheets')).toBeNull();
  });

  /**
   * `onRequestClose` is Android's hardware Back and the keyboard's Escape. It
   * is what makes the menu operable without a touch screen — every row is a
   * button a hardware keyboard can Tab to and fire, and this is the way out
   * that does not need one to be found first.
   */
  it('closes on Escape and on the hardware back button', async () => {
    await renderScreen(<Shell />);
    await open();
    await fireEvent(screen.getByTestId('drawer-modal'), 'requestClose');
    expect(screen.queryByText('Timesheets')).toBeNull();
  });

  it('lets a row close the menu behind itself', async () => {
    await renderScreen(<Shell />);
    await open();
    await fireEvent.press(screen.getByTestId('menu-row'));
    expect(screen.queryByText('Timesheets')).toBeNull();
  });

  it('holds the screen reader inside the panel while it is open', async () => {
    await renderScreen(<Shell />);
    await open();
    expect(screen.getByTestId('drawer-panel').props.accessibilityViewIsModal).toBe(true);
  });

  /**
   * The Queue tab's badge was the only always-visible sign that this phone was
   * holding work it had not sent. The tab is gone; the dot is what replaces it.
   */
  it('marks the burger when something is waiting to send', async () => {
    await renderScreen(<Shell mark={waiting} />);
    expect(screen.getByTestId('menu-dot')).toBeTruthy();
    // The dot is a shape; the label is what a screen reader has.
    expect(screen.getByLabelText('Menu, something is waiting to send')).toBeTruthy();
  });

  /**
   * The Queue tab's badge turned red when something had stopped trying and
   * stayed plain while the phone was only waiting for signal. One dot for both
   * would tell a technician holding a failed "Arrived" that the phone had it
   * in hand.
   */
  it('says, and shows, when something has stopped trying rather than waiting', async () => {
    await renderScreen(<Shell mark={failed} />);
    const alarmed = screen.getByTestId('menu-dot').props.style;
    expect(screen.getByLabelText('Menu, something could not be sent')).toBeTruthy();

    await renderScreen(<Shell mark={waiting} />);
    expect(screen.getByTestId('menu-dot').props.style).not.toEqual(alarmed);
  });

  it('says only "Menu" when there is nothing waiting', async () => {
    await renderScreen(<Shell />);
    expect(screen.queryByTestId('menu-dot')).toBeNull();
    expect(screen.getByLabelText('Menu')).toBeTruthy();
  });

  /**
   * A screen carrying a burger has to be renderable on its own — the tests for
   * Home and Schedule do exactly that — so the context defaults to a no-op
   * rather than throwing.
   */
  it('does nothing, rather than crashing, with no host above it', async () => {
    await renderScreen(<MenuButton />);
    await fireEvent.press(screen.getByTestId('open-menu'));
    expect(screen.getByTestId('open-menu')).toBeTruthy();
  });
});

describe('DrawerRow', () => {
  it('reads its count out with its name, since the badge is a shape', async () => {
    await renderScreen(
      <DrawerRow label="Waiting to send" badge="3" hint="Not sent yet" onPress={jest.fn()} />,
    );
    expect(screen.getByLabelText('Waiting to send, 3')).toBeTruthy();
  });

  it('paints the count itself red when it is a count of failures', async () => {
    await renderScreen(
      <DrawerRow
        testID="row"
        label="Waiting to send"
        badge="3"
        badgeTone="danger"
        onPress={jest.fn()}
      />,
    );
    const alarmed = screen.getByTestId('row-badge').props.style;

    await renderScreen(
      <DrawerRow testID="row" label="Waiting to send" badge="3" onPress={jest.fn()} />,
    );
    expect(screen.getByTestId('row-badge').props.style).not.toEqual(alarmed);
  });
});
