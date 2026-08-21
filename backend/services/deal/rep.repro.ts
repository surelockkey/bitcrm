import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateExternalCompanyDto } from './src/external-companies/dto/create-external-company.dto';
import { UpdateExternalCompanyDto } from './src/external-companies/dto/update-external-company.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });

async function run(dto: any, body: any, label: string) {
  try {
    const out = await pipe.transform(body, { type: 'body', metatype: dto });
    console.log(label, 'PASS ->', JSON.stringify(out));
  } catch (e: any) {
    console.log(label, 'REJECT ->', JSON.stringify(e.getResponse ? e.getResponse() : e.message));
  }
}

(async () => {
  await run(CreateExternalCompanyDto, { name: 'Agero', email: '', address: '', phone: '', active: true }, 'CREATE blank email:');
  await run(CreateExternalCompanyDto, { name: 'Agero', email: 'a@b.com', address: '', phone: '', active: true }, 'CREATE valid email:');
  await run(UpdateExternalCompanyDto, { name: 'Agero', email: '', address: '', phone: '', active: true }, 'UPDATE blank email:');
})();
(async () => {
  await run(CreateExternalCompanyDto, { name: 'Agero', email: 'not-an-email', address: '', phone: '', active: true }, 'CREATE bad email:');
  await run(CreateExternalCompanyDto, { name: '', email: 'a@b.com' }, 'CREATE empty name:');
  await run(CreateExternalCompanyDto, { name: 'Agero', active: 'yes' }, 'CREATE bad bool:');
  await run(CreateExternalCompanyDto, { name: 'Agero', email: '  ', address: '', phone: '', active: true }, 'CREATE whitespace email:');
})();
