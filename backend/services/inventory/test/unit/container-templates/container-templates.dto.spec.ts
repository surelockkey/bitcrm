import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContainerTemplateDto } from 'src/container-templates/dto/create-container-template.dto';
import { UpdateContainerTemplateDto } from 'src/container-templates/dto/update-container-template.dto';
import { ContainerTemplateDiffQueryDto } from 'src/container-templates/dto/container-template-diff-query.dto';
import { FillContainerTemplateDto } from 'src/container-templates/dto/fill-container-template.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

const items = [{ productId: 'prod-1', quantity: 5 }];

describe('CreateContainerTemplateDto', () => {
  it('accepts a name and at least one line', async () => {
    expect(await errorsFor(CreateContainerTemplateDto, { name: 'Standard van', items })).toEqual([]);
    expect(
      await errorsFor(CreateContainerTemplateDto, { name: 'Standard van', description: 'Every van', items }),
    ).toEqual([]);
  });

  it('requires a non-blank name', async () => {
    expect(await errorsFor(CreateContainerTemplateDto, { items })).toEqual(['name']);
    expect(await errorsFor(CreateContainerTemplateDto, { name: '   ', items })).toEqual(['name']);
  });

  it('requires lines, each a whole quantity of at least one', async () => {
    expect(await errorsFor(CreateContainerTemplateDto, { name: 'Van' })).toEqual(['items']);
    expect(await errorsFor(CreateContainerTemplateDto, { name: 'Van', items: [] })).toEqual(['items']);
    expect(
      await errorsFor(CreateContainerTemplateDto, { name: 'Van', items: [{ productId: 'p', quantity: 0 }] }),
    ).toEqual(['items']);
    expect(
      await errorsFor(CreateContainerTemplateDto, { name: 'Van', items: [{ productId: 'p', quantity: 1.5 }] }),
    ).toEqual(['items']);
    expect(await errorsFor(CreateContainerTemplateDto, { name: 'Van', items: [{ quantity: 1 }] })).toEqual([
      'items',
    ]);
  });
});

describe('UpdateContainerTemplateDto', () => {
  it('takes any subset of the fields', async () => {
    expect(await errorsFor(UpdateContainerTemplateDto, {})).toEqual([]);
    expect(await errorsFor(UpdateContainerTemplateDto, { name: 'Big van' })).toEqual([]);
    expect(await errorsFor(UpdateContainerTemplateDto, { items, status: 'archived' })).toEqual([]);
  });

  it('clears the description with null, and refuses null for the rest', async () => {
    expect(await errorsFor(UpdateContainerTemplateDto, { description: null })).toEqual([]);
    expect(await errorsFor(UpdateContainerTemplateDto, { name: null })).toEqual(['name']);
    expect(await errorsFor(UpdateContainerTemplateDto, { items: null })).toEqual(['items']);
    expect(await errorsFor(UpdateContainerTemplateDto, { status: null })).toEqual(['status']);
  });

  it('refuses an empty line list and an unknown status', async () => {
    expect(await errorsFor(UpdateContainerTemplateDto, { items: [] })).toEqual(['items']);
    expect(await errorsFor(UpdateContainerTemplateDto, { status: 'deleted' })).toEqual(['status']);
  });
});

describe('ContainerTemplateDiffQueryDto', () => {
  it('requires the container and takes a warehouse optionally', async () => {
    expect(await errorsFor(ContainerTemplateDiffQueryDto, { containerId: 'c-1' })).toEqual([]);
    expect(await errorsFor(ContainerTemplateDiffQueryDto, { containerId: 'c-1', warehouseId: 'wh-1' })).toEqual([]);
    expect(await errorsFor(ContainerTemplateDiffQueryDto, { warehouseId: 'wh-1' })).toEqual(['containerId']);
  });
});

describe('FillContainerTemplateDto', () => {
  const requestId = '3f1c2a9e-6d4b-4c8e-9a1f-2b7d5e0c4a11';

  it('requires the container, the warehouse and a request id', async () => {
    expect(await errorsFor(FillContainerTemplateDto, { containerId: 'c-1', warehouseId: 'wh-1', requestId })).toEqual(
      [],
    );
    expect(await errorsFor(FillContainerTemplateDto, { containerId: 'c-1', requestId })).toEqual(['warehouseId']);
    expect(await errorsFor(FillContainerTemplateDto, { warehouseId: 'wh-1', requestId })).toEqual(['containerId']);
  });

  // Ключ ідемпотентності: веб генерує UUID на кожне відкриття попапу Apply.
  it('requires the request id to be a UUID', async () => {
    expect(await errorsFor(FillContainerTemplateDto, { containerId: 'c-1', warehouseId: 'wh-1' })).toEqual([
      'requestId',
    ]);
    expect(
      await errorsFor(FillContainerTemplateDto, { containerId: 'c-1', warehouseId: 'wh-1', requestId: 'again' }),
    ).toEqual(['requestId']);
  });
});
