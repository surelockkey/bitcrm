import { Test } from '@nestjs/testing';
import { GeocodingService } from '@bitcrm/shared';
import { TechniciansService } from '../../../src/technicians/technicians.service';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import { TechniciansCacheService } from '../../../src/technicians/technicians-cache.service';
import { RolesService } from '../../../src/roles/roles.service';
import {
  createMockJwtUser,
  createMockTechniciansRepository,
  createMockTechniciansCacheService,
  createMockRolesServiceByPriority,
} from '../mocks';

/**
 * A technician's home is the fallback position on the dispatch map (used when
 * they have no jobs today) and the anchor for distance ranking. Without
 * coordinates they cannot be mapped or ranked — and the profile form re-sends
 * the address without lat/lng, which used to erase them.
 */
describe('TechniciansService — home address geocoding', () => {
  let service: TechniciansService;
  let repo: ReturnType<typeof createMockTechniciansRepository>;
  let geocoding: { geocode: jest.Mock };

  const self = createMockJwtUser({ id: 'tech-1' });

  const HOME = {
    line1: '1 Peachtree St',
    city: 'Atlanta',
    state: 'GA',
    zip: '30303',
  };

  beforeEach(async () => {
    repo = createMockTechniciansRepository();
    geocoding = { geocode: jest.fn().mockResolvedValue({ lat: 33.749, lng: -84.388 }) };

    repo.updateProfile.mockImplementation(async (_id: string, patch: any) => ({
      userId: 'tech-1',
      ...patch,
    }));

    const module = await Test.createTestingModule({
      providers: [
        TechniciansService,
        { provide: TechniciansRepository, useValue: repo },
        { provide: TechniciansCacheService, useValue: createMockTechniciansCacheService() },
        { provide: RolesService, useValue: createMockRolesServiceByPriority() },
        { provide: GeocodingService, useValue: geocoding },
      ],
    }).compile();

    service = module.get(TechniciansService);
  });

  it('geocodes a home address saved without coordinates', async () => {
    repo.getProfile.mockResolvedValue({ userId: 'tech-1', status: 'active' });

    await service.updateProfile('tech-1', { homeAddress: HOME } as any, self);

    expect(geocoding.geocode).toHaveBeenCalledTimes(1);
    const written = repo.updateProfile.mock.calls[0][1];
    expect(written.homeAddress.lat).toBe(33.749);
    expect(written.homeAddress.lng).toBe(-84.388);
  });

  // The bug that would quietly un-map every technician.
  it('keeps existing coordinates when the same address is re-saved without them', async () => {
    repo.getProfile.mockResolvedValue({
      userId: 'tech-1',
      status: 'active',
      homeAddress: { ...HOME, lat: 33.749, lng: -84.388 },
    });

    await service.updateProfile('tech-1', { homeAddress: HOME } as any, self);

    expect(geocoding.geocode).not.toHaveBeenCalled();
    const written = repo.updateProfile.mock.calls[0][1];
    expect(written.homeAddress.lat).toBe(33.749);
    expect(written.homeAddress.lng).toBe(-84.388);
  });

  it('re-geocodes when the home address actually changes', async () => {
    repo.getProfile.mockResolvedValue({
      userId: 'tech-1',
      status: 'active',
      homeAddress: { ...HOME, lat: 33.749, lng: -84.388 },
    });
    geocoding.geocode.mockResolvedValue({ lat: 40, lng: -70 });

    await service.updateProfile(
      'tech-1',
      { homeAddress: { ...HOME, line1: '500 Elsewhere Ave' } } as any,
      self,
    );

    expect(geocoding.geocode).toHaveBeenCalledTimes(1);
    const written = repo.updateProfile.mock.calls[0][1];
    expect(written.homeAddress.lat).toBe(40);
  });

  it('still saves the profile when the address cannot be geocoded', async () => {
    repo.getProfile.mockResolvedValue({ userId: 'tech-1', status: 'active' });
    geocoding.geocode.mockResolvedValue(null);

    await service.updateProfile('tech-1', { homeAddress: HOME } as any, self);

    const written = repo.updateProfile.mock.calls[0][1];
    expect(written.homeAddress.lat).toBeUndefined();
    expect(repo.updateProfile).toHaveBeenCalled();
  });

  it('does not geocode when the update leaves the address alone', async () => {
    repo.getProfile.mockResolvedValue({ userId: 'tech-1', status: 'active' });

    await service.updateProfile('tech-1', { phone: '+1 555 0100' } as any, self);

    expect(geocoding.geocode).not.toHaveBeenCalled();
  });
});
