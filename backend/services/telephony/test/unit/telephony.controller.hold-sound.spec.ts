import { BadRequestException } from '@nestjs/common';
import { TelephonyController } from '../../src/telephony/telephony.controller';

/**
 * PUT /telephony/config/hold-sound — the company's hold music. Telephony runs
 * without a ValidationPipe, so the body reaches the service as sent and the
 * service is the one that refuses a bad shape.
 */
function makeController(setHoldSound = jest.fn()) {
  const settings = { setHoldSound };
  return {
    controller: new TelephonyController({} as never, settings as never, {} as never),
    setHoldSound,
  };
}

describe('TelephonyController.setHoldSound', () => {
  it('hands the chosen sound to the settings and answers with the settings', async () => {
    const saved = { technicianLine: null, fallbackNumber: null, holdSound: { kind: 'premade', id: 'ambient' } };
    const { controller, setHoldSound } = makeController(jest.fn().mockResolvedValue(saved));

    await expect(
      controller.setHoldSound({ holdSound: { kind: 'premade', id: 'ambient' } } as never),
    ).resolves.toEqual({ success: true, data: saved });
    expect(setHoldSound).toHaveBeenCalledWith({ kind: 'premade', id: 'ambient' });
  });

  it('treats an explicit null as "back to the default"', async () => {
    const { controller, setHoldSound } = makeController(jest.fn().mockResolvedValue({}));
    await controller.setHoldSound({ holdSound: null } as never);
    expect(setHoldSound).toHaveBeenCalledWith(null);
  });

  it('refuses a body that does not say which sound', async () => {
    const { controller, setHoldSound } = makeController();
    await expect(controller.setHoldSound({} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.setHoldSound(undefined as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(setHoldSound).not.toHaveBeenCalled();
  });
});
