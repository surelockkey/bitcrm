import { decodeHtmlEntities, htmlToText, looksLikeHtml } from '../../../src/templates/html-text';

describe('htmlToText', () => {
  it('turns Workiz paragraph HTML into SMS text', () => {
    const html =
      '<p>Hi, {{client_first_name}} !</p>\n<p>&nbsp;Please, confirm services with us by signing an invoice.</p>\n' +
      '<p>Thank you for contacting us and have a nice day!&nbsp;</p>';
    expect(htmlToText(html)).toBe(
      'Hi, {{client_first_name}} !\n Please, confirm services with us by signing an invoice.\nThank you for contacting us and have a nice day!',
    );
  });

  it('keeps inline emphasis text, drops the tags, honours <br>', () => {
    expect(htmlToText('<p><em>Hi!</em> This is <strong>the</strong> locksmith.<br>Call us.</p>')).toBe(
      'Hi! This is the locksmith.\nCall us.',
    );
  });

  it('collapses runs of blank lines and trims trailing whitespace', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b   </p>')).toBe('a\n\nb');
  });

  it('passes plain text through, decoding entities only', () => {
    expect(htmlToText('New job #{{job_id}}\n{{full_name}} &amp; co')).toBe('New job #{{job_id}}\n{{full_name}} & co');
  });

  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('&lt;a&gt; &quot;q&quot; &#39;s&#39; &#x1F511; &unknown;')).toBe(
      '<a> "q" \'s\' \u{1F511} &unknown;',
    );
  });

  it('renders list items with a bullet', () => {
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('• one\n• two');
  });

  it('detects markup', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true);
    expect(looksLikeHtml('a < b and b > c')).toBe(false);
  });
});
