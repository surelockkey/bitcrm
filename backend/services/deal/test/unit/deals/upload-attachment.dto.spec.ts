import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UploadAttachmentDto } from 'src/deals/attachments/dto/upload-attachment.dto';

const errorsFor = async (contentType: string) =>
  (await validate(plainToInstance(UploadAttachmentDto, { fileName: 'f', contentType }))).map((e) => e.property);

/**
 * What a job or a client may hold as a file: photos and PDFs as before, plus
 * the Office documents (docx / xlsx) and short videos (mp4) Workiz lets a
 * client card keep — and still nothing executable or arbitrary.
 */
describe('UploadAttachmentDto.contentType', () => {
  it.each([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
  ])('accepts %s', async (type) => {
    expect(await errorsFor(type)).toEqual([]);
  });

  it.each([
    'application/octet-stream',
    'application/x-msdownload',
    'text/html',
    'image/svg+xml',
    'video/quicktime',
    'application/vnd.openxmlformats-officedocument.',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=x',
    '',
  ])('rejects %s', async (type) => {
    expect(await errorsFor(type)).toEqual(['contentType']);
  });
});
