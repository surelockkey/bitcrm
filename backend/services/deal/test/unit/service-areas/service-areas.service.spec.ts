import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ServiceAreasService } from 'src/service-areas/service-areas.service';
import { ServiceAreaType } from '@bitcrm/types';
import {
  createMockServiceAreasRepository,
  createMockGeocodingService,
  createMockSnsPublisherService,
  createMockServiceArea,
  createMockJwtUser,
} from '../mocks';

describe('ServiceAreasService', () => {
  let repo: ReturnType<typeof createMockServiceAreasRepository>;
  let geocoding: ReturnType<typeof createMockGeocodingService>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: ServiceAreasService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockServiceAreasRepository();
    geocoding = createMockGeocodingService();
    sns = createMockSnsPublisherService();
    service = new ServiceAreasService(repo as any, geocoding as any, sns as any);
  });

  describe('create', () => {
    it('geocodes zips, derives coverage, persists and emits an event', async () => {
      geocoding.geocode.mockResolvedValue({ lat: 33.75, lng: -84.39 });
      const dto = {
        name: 'Atlanta',
        type: ServiceAreaType.ZIPS,
        zips: [{ zip: '30301', radiusMiles: 5 }],
      };

      const area = await service.create(dto as any, caller);

      expect(area.coverage).toEqual([
        { kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 },
      ]);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Atlanta' }));
      expect(sns.publish).toHaveBeenCalledWith(
        'deal-events',
        'service-area.created',
        expect.objectContaining({ serviceAreaId: area.id }),
      );
    });

    it('rejects a new area that overlaps an existing active one', async () => {
      geocoding.geocode.mockResolvedValue({ lat: 33.75, lng: -84.39 });
      repo.listAll.mockResolvedValue([
        createMockServiceArea({
          id: 'existing',
          coverage: [{ kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 }],
        }),
      ]);
      const dto = { name: 'Dup', type: ServiceAreaType.ZIPS, zips: [{ zip: '30301' }] };

      await expect(service.create(dto as any, caller)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows a non-overlapping area', async () => {
      geocoding.geocode.mockResolvedValue({ lat: 40.0, lng: -80.0 });
      repo.listAll.mockResolvedValue([
        createMockServiceArea({
          id: 'existing',
          coverage: [{ kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 }],
        }),
      ]);
      const dto = { name: 'Far', type: ServiceAreaType.ZIPS, zips: [{ zip: '15201' }] };

      await expect(service.create(dto as any, caller)).resolves.toBeDefined();
      expect(repo.create).toHaveBeenCalled();
    });

    it('skips overlap check for an inactive (draft) area', async () => {
      geocoding.geocode.mockResolvedValue({ lat: 33.75, lng: -84.39 });
      repo.listAll.mockResolvedValue([
        createMockServiceArea({
          id: 'existing',
          coverage: [{ kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 }],
        }),
      ]);
      const dto = { name: 'Draft', active: false, type: ServiceAreaType.ZIPS, zips: [{ zip: '30301' }] };

      await expect(service.create(dto as any, caller)).resolves.toBeDefined();
    });

    it('rejects a zip area with no zips', async () => {
      const dto = { name: 'Bad', type: ServiceAreaType.ZIPS };
      await expect(service.create(dto as any, caller)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws NotFound when missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes and emits an event', async () => {
      repo.get.mockResolvedValue(createMockServiceArea({ id: 'a-1' }));
      await service.remove('a-1', caller);
      expect(repo.remove).toHaveBeenCalledWith('a-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'service-area.deleted', expect.any(Object));
    });
  });

  describe('resolvePoint', () => {
    it('returns the single active area containing the point', async () => {
      repo.listAll.mockResolvedValue([
        createMockServiceArea({
          id: 'in',
          coverage: [{ kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 }],
        }),
        createMockServiceArea({
          id: 'out',
          coverage: [{ kind: 'circle', lat: 40, lng: -80, radiusMiles: 5 }],
        }),
      ]);
      const area = await service.resolvePoint({ lat: 33.75, lng: -84.39 });
      expect(area?.id).toBe('in');
    });

    it('returns null when no area contains the point', async () => {
      repo.listAll.mockResolvedValue([
        createMockServiceArea({ coverage: [{ kind: 'circle', lat: 40, lng: -80, radiusMiles: 5 }] }),
      ]);
      expect(await service.resolvePoint({ lat: 33.75, lng: -84.39 })).toBeNull();
    });

    it('ignores inactive areas', async () => {
      repo.listAll.mockResolvedValue([
        createMockServiceArea({
          id: 'inactive',
          active: false,
          coverage: [{ kind: 'circle', lat: 33.75, lng: -84.39, radiusMiles: 5 }],
        }),
      ]);
      expect(await service.resolvePoint({ lat: 33.75, lng: -84.39 })).toBeNull();
    });
  });

  describe('resolve', () => {
    it('uses explicit lat/lng directly without geocoding', async () => {
      repo.listAll.mockResolvedValue([]);
      await service.resolve({ lat: 1, lng: 2 } as any);
      expect(geocoding.geocode).not.toHaveBeenCalled();
    });

    it('geocodes the address when no coordinates are given', async () => {
      geocoding.geocode.mockResolvedValue({ lat: 33.75, lng: -84.39 });
      repo.listAll.mockResolvedValue([]);
      await service.resolve({ address: { street: '1 Peachtree', city: 'Atlanta', state: 'GA', zip: '30301' } } as any);
      expect(geocoding.geocode).toHaveBeenCalled();
    });
  });
});
