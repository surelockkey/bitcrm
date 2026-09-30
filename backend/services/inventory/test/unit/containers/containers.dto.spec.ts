import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContainerDto } from 'src/containers/dto/create-container.dto';
import { UpdateContainerDto } from 'src/containers/dto/update-container.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

/** Фургон може мати шаблон завантаження; null на оновленні його знімає. */
describe('container DTOs — templateId', () => {
  it('takes a template id on create', async () => {
    expect(await errorsFor(CreateContainerDto, { name: 'Van 1', templateId: 'tpl-1' })).toEqual([]);
    expect(await errorsFor(CreateContainerDto, { name: 'Van 1', templateId: 7 })).toEqual(['templateId']);
  });

  it('takes a template id or null on update', async () => {
    expect(await errorsFor(UpdateContainerDto, { templateId: 'tpl-1' })).toEqual([]);
    expect(await errorsFor(UpdateContainerDto, { templateId: null })).toEqual([]);
    expect(await errorsFor(UpdateContainerDto, { templateId: 7 })).toEqual(['templateId']);
  });
});
