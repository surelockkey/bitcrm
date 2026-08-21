import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateExternalCompanyDto } from './src/external-companies/dto/create-external-company.dto';

(async () => {
  const inst = plainToInstance(CreateExternalCompanyDto, { name: 'Agero', email: '', address: '', phone: '', active: true });
  console.log('instance:', JSON.stringify(inst), 'email typeof', typeof (inst as any).email, 'len', (inst as any).email?.length);
  console.log('errors:', JSON.stringify(await validate(inst as any)));

  const raw = new CreateExternalCompanyDto();
  (raw as any).name = 'Agero'; (raw as any).email = '';
  console.log('raw errors:', JSON.stringify((await validate(raw)).map(e => e.constraints)));
})();
