import { buildFileName, normalizeContentType } from './capture';

describe('normalizeContentType', () => {
  it('keeps a type the server accepts', () => {
    expect(normalizeContentType('image/png', 'file:///x.png')).toBe('image/png');
    expect(normalizeContentType('image/heic', 'file:///x.heic')).toBe('image/heic');
    expect(normalizeContentType('application/pdf', 'file:///x.pdf')).toBe(
      'application/pdf',
    );
  });

  it('ignores the charset some pickers tack on', () => {
    expect(normalizeContentType('image/jpeg; charset=binary', 'file:///x.jpg')).toBe(
      'image/jpeg',
    );
  });

  it('falls back to the extension when the phone declares nothing', () => {
    expect(normalizeContentType(null, 'file:///photos/IMG_0001.HEIC')).toBe('image/heic');
    expect(normalizeContentType(undefined, 'file:///photos/scan.pdf')).toBe(
      'application/pdf',
    );
  });

  it('ignores a query string on the URI', () => {
    expect(normalizeContentType(null, 'file:///photos/a.png?width=100')).toBe('image/png');
  });

  it('calls anything unrecognised a JPEG rather than letting the server 400 it', () => {
    // The endpoint validates against a fixed regex; a rejected upload the
    // technician cannot explain is worse than a slightly wrong label.
    expect(normalizeContentType('image/tiff', 'file:///photos/a.tiff')).toBe('image/jpeg');
    expect(normalizeContentType(null, 'file:///photos/noextension')).toBe('image/jpeg');
  });
});

describe('buildFileName', () => {
  const takenAt = new Date('2026-09-16T13:04:05.678Z');

  it('names a file after the job and the moment, so a list of them reads', () => {
    expect(buildFileName('K4T9ZW', 'image/jpeg', takenAt)).toBe(
      'job-K4T9ZW-2026-09-16_13-04-05.jpg',
    );
  });

  it('carries the right extension for each accepted type', () => {
    expect(buildFileName('J1', 'image/png', takenAt)).toMatch(/\.png$/);
    expect(buildFileName('J1', 'image/heic', takenAt)).toMatch(/\.heic$/);
    expect(buildFileName('J1', 'application/pdf', takenAt)).toMatch(/\.pdf$/);
  });

  it('never produces a name with a colon in it — some filesystems refuse them', () => {
    expect(buildFileName('J1', 'image/jpeg', takenAt)).not.toContain(':');
  });
});
