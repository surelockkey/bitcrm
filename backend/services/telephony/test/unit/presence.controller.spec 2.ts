import { PresenceController } from 'src/presence/presence.controller';

/**
 * The picker behind both "transfer this call" and "who is in this group".
 * Those two want opposite things about the caller themselves, which is the
 * whole reason `includeSelf` exists — leaving yourself out of a group picker
 * is how somebody ends up adding a different account with the same name.
 */
function build(online: string[] = ['me']) {
  const presence = { listOnline: jest.fn(async () => online) };
  const directory = {
    list: jest.fn(async () => [
      { id: 'me', name: 'Nazarii Shparhalo', email: 'nazarsh13@gmail.com' },
      { id: 'other', name: 'Nazarii Shparhalo', email: 'nazar@surelockkey.com' },
      { id: 'dana', name: 'Dana Petrenko', email: 'dana@surelockkey.com' },
    ]),
  };
  return {
    controller: new PresenceController(presence as never, directory as never),
  };
}

const ME = { id: 'me' } as never;

describe('PresenceController.online', () => {
  it('leaves the caller out by default — you cannot transfer to yourself', async () => {
    const { controller } = build();

    const { data } = await controller.online(ME);

    expect(data.map((u) => u.id)).not.toContain('me');
  });

  it('keeps the caller when asked, which is what building a group needs', async () => {
    const { controller } = build();

    const { data } = await controller.online(ME, '1');

    expect(data.map((u) => u.id)).toContain('me');
    // …and the one online person is the caller, so a group picker that hid
    // them would show nobody online at all.
    expect(data.find((u) => u.id === 'me')?.softphoneOnline).toBe(true);
  });

  it('carries the email, the only thing telling two same-named accounts apart', async () => {
    const { controller } = build();

    const { data } = await controller.online(ME, '1');
    const sameName = data.filter((u) => u.name === 'Nazarii Shparhalo');

    expect(sameName).toHaveLength(2);
    expect(sameName.map((u) => u.email).sort()).toEqual([
      'nazar@surelockkey.com',
      'nazarsh13@gmail.com',
    ]);
  });

  it('puts whoever can answer right now at the top', async () => {
    const { controller } = build(['dana']);

    const { data } = await controller.online(ME, '1');

    expect(data[0].id).toBe('dana');
  });
});
