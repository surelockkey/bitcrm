import { attachmentLinksSection, emailBodies, textToHtml } from '../../../src/email/email-body';

describe('textToHtml', () => {
  it('turns paragraphs and line breaks into markup, escaping everything', () => {
    expect(textToHtml('Hi Jane,\nyour key <3\n\nThanks & bye')).toBe('<p>Hi Jane,<br>your key &lt;3</p>\n<p>Thanks &amp; bye</p>');
    expect(textToHtml('  one  ')).toBe('<p>one</p>');
    expect(textToHtml('a\r\n\r\nb')).toBe('<p>a</p>\n<p>b</p>');
  });
});

describe('emailBodies', () => {
  it('keeps HTML as the html part with a text alternative, wraps plain text', () => {
    expect(emailBodies('<p>Hi <b>Jane</b></p><p>Bye</p>')).toEqual({ html: '<p>Hi <b>Jane</b></p><p>Bye</p>', text: 'Hi Jane\nBye' });
    expect(emailBodies('Hi Jane\n\nBye')).toEqual({ html: '<p>Hi Jane</p>\n<p>Bye</p>', text: 'Hi Jane\n\nBye' });
  });
});

describe('attachmentLinksSection', () => {
  it('renders a footer in both formats with sizes, and nothing for no links', () => {
    const out = attachmentLinksSection([
      { fileName: 'a.pdf', url: 'https://s3/a?x=1&y=2', size: 512 },
      { fileName: 'b<1>.jpg', url: 'https://s3/b', size: 3 * 1024 * 1024 },
      { fileName: 'c.txt', url: 'https://s3/c' },
    ]);
    expect(out.html).toBe(
      '<p>Attachments:</p><ul><li><a href="https://s3/a?x=1&amp;y=2">a.pdf</a> (512 B)</li><li><a href="https://s3/b">b&lt;1&gt;.jpg</a> (3.0 MB)</li><li><a href="https://s3/c">c.txt</a></li></ul>',
    );
    expect(out.text).toBe('\n\nAttachments:\n- a.pdf (512 B): https://s3/a?x=1&y=2\n- b<1>.jpg (3.0 MB): https://s3/b\n- c.txt: https://s3/c');
    expect(attachmentLinksSection([])).toEqual({ html: '', text: '' });
  });
});
