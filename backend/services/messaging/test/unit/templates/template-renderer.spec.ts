import { NotFoundException } from '@nestjs/common';
import { TemplateRenderer, extractShortCodes } from '../../../src/templates/template-renderer';
import { createMockTemplate } from '../mocks';
import { fullContext } from './render-fixtures';

function makeRenderer(templates = [createMockTemplate()], ctx = fullContext()) {
  const repo = { get: jest.fn(async (id: string) => templates.find((t) => t.id === id) ?? null) };
  const loader = { load: jest.fn(async () => ctx) };
  return { renderer: new TemplateRenderer(repo as any, loader as any), repo, loader };
}

describe('TemplateRenderer', () => {
  describe('renderWithContext', () => {
    it('substitutes every known code and reports nothing missing', () => {
      const { renderer } = makeRenderer();
      const out = renderer.renderWithContext(
        { body: 'Hi {{first_name}}, {{tech_assigned}} arrives {{job_date}} at {{appointment_time}}. Job #{{job_id}}' },
        fullContext(),
      );
      expect(out).toEqual({
        body: 'Hi Jane, Mike Smith arrives Sep 15, 2026 at 2:30 PM. Job #K4T9ZW',
        subject: undefined,
        missing: [],
      });
    });

    it('tolerates whitespace inside the braces', () => {
      const { renderer } = makeRenderer();
      expect(renderer.renderWithContext({ body: '{{ first_name }}|{{last_name }}' }, fullContext()).body).toBe('Jane|Doe');
    });

    it('blanks unresolved codes and lists them once, in order', () => {
      const { renderer } = makeRenderer();
      const out = renderer.renderWithContext({ body: 'A {{nope}} B {{late_value}} C {{nope}} D {{first_name}}' }, {});
      expect(out.body).toBe('A  B  C  D ');
      expect(out.missing).toEqual(['nope', 'late_value', 'first_name']);
    });

    it('keeps unresolved codes visible with keepMissing', () => {
      const { renderer } = makeRenderer();
      const out = renderer.renderWithContext({ body: 'Hi {{first_name}} {{ nope }}', keepMissing: true }, fullContext());
      expect(out.body).toBe('Hi Jane {{ nope }}');
      expect(out.missing).toEqual(['nope']);
    });

    it('renders Workiz HTML bodies as SMS text before substituting', () => {
      const { renderer } = makeRenderer();
      const out = renderer.renderWithContext(
        { body: '<p>Hi, {{client_first_name}} !</p>\n<p>&nbsp;Please sign the invoice for job {{job_id}}.</p>' },
        fullContext(),
      );
      expect(out.body).toBe('Hi, Jane !\n Please sign the invoice for job K4T9ZW.');
    });

    it('keeps HTML and escapes values in html format', () => {
      const { renderer } = makeRenderer();
      const ctx = fullContext();
      ctx.contact!.firstName = 'Jane <3 & "Co"';
      const out = renderer.renderWithContext({ body: '<p>Hi {{first_name}}</p>', format: 'html' }, ctx);
      expect(out.body).toBe('<p>Hi Jane &lt;3 &amp; &quot;Co&quot;</p>');
    });

    it('does not treat a substituted value as markup in text format', () => {
      const { renderer } = makeRenderer();
      const ctx = fullContext();
      ctx.deal!.notes = 'Client said <call first>';
      expect(renderer.renderWithContext({ body: '<p>{{description}}</p>' }, ctx).body).toBe('Client said <call first>');
    });

    it('renders the subject as text', () => {
      const { renderer } = makeRenderer();
      const out = renderer.renderWithContext({ body: 'x', subject: 'Job {{job_id}} — {{job_type}}' }, fullContext());
      expect(out.subject).toBe('Job K4T9ZW — Lock change');
    });

    it('resolves deal custom fields by name, case-insensitively, with arrays and booleans readable', () => {
      const { renderer } = makeRenderer();
      const ctx = fullContext();
      ctx.customFields = { 'Manager Note': 'Bring shims', 'Choose Company ': ['A1', 'SLK'], VPO: true, Quantity: 3, 'C PO': '' };
      const out = renderer.renderWithContext(
        { body: '{{Manager Note}}|{{manager note}}|{{Choose Company}}|{{VPO}}|{{Quantity}}|{{C PO}}' },
        ctx,
      );
      expect(out.body).toBe('Bring shims|Bring shims|A1, SLK|Yes|3|');
      expect(out.missing).toEqual(['C PO']);
    });

    it('lets explicit values win over the context and fill custom codes', () => {
      const { renderer } = makeRenderer();
      const ctx = fullContext();
      ctx.values = { first_name: 'Sample', late_value: '20', anything: 'goes' };
      const out = renderer.renderWithContext({ body: '{{first_name}} {{late_value}} {{anything}}' }, ctx);
      expect(out.body).toBe('Sample 20 goes');
      expect(out.missing).toEqual([]);
    });

    it('renders the Workiz "late" tech template and sms_format unchanged', () => {
      const { renderer } = makeRenderer();
      const late =
        'Hi {{first_name}}, \nThis is {{tech_assigned}} from Sure Lock and Key LLC. \nUnfortunately it appears that I will be {{late_value}} minutes late.';
      expect(renderer.renderWithContext({ body: late }, fullContext()).body).toBe(
        'Hi Jane, \nThis is Mike Smith from Sure Lock and Key LLC. \nUnfortunately it appears that I will be 15 minutes late.',
      );
      const smsFormat =
        'New job #{{job_id}}\n{{full_name}}   \n\n\n{{phone_number}}\n\n\n{{full_address}}\n\n \n{{job_type}} \nNotes: {{description}}';
      expect(renderer.renderWithContext({ body: smsFormat }, fullContext())).toEqual({
        body: 'New job #K4T9ZW\nJane Doe   \n\n\n(404) 555-1234\n\n\n12 Main St Apt 3, Atlanta, GA 30301\n\n \nLock change \nNotes: Rekey front and back doors',
        subject: undefined,
        missing: [],
      });
    });
  });

  describe('render', () => {
    it('loads the context from the ids and renders the stored template as text', async () => {
      const { renderer, loader } = makeRenderer();
      const out = await renderer.render({ templateId: 't1' }, { conversationId: 'c1', dealId: 'd1', userId: 'u7' });
      expect(loader.load).toHaveBeenCalledWith({ conversationId: 'c1', dealId: 'd1', userId: 'u7' });
      expect(out).toEqual({ body: 'Hi Jane, on my way.', subject: undefined, missing: [] });
    });

    it('renders email templates as html with their subject', async () => {
      const { renderer } = makeRenderer([
        createMockTemplate({
          id: 'e1',
          channel: 'email',
          messageTemplate: '<p>Dear {{full_name}}</p>',
          messageSubjectTemplate: 'Job {{job_id}}',
        }),
      ]);
      expect(await renderer.render({ templateId: 'e1' }, {})).toEqual({
        body: '<p>Dear Jane Doe</p>',
        subject: 'Job K4T9ZW',
        missing: [],
      });
    });

    it('renders an ad-hoc body without a template and passes values through', async () => {
      const { renderer, loader } = makeRenderer();
      const out = await renderer.render({ body: 'Late by {{late_value}}' }, { dealId: 'd1', values: { late_value: '15' } });
      expect(loader.load).toHaveBeenCalledWith({ dealId: 'd1', values: { late_value: '15' } });
      expect(out.body).toBe('Late by 15');
    });

    it('lets a draft body override the stored one', async () => {
      const { renderer } = makeRenderer();
      expect((await renderer.render({ templateId: 't1', body: 'Bye {{first_name}}' }, {})).body).toBe('Bye Jane');
    });

    it('404s on an unknown template', async () => {
      const { renderer } = makeRenderer();
      await expect(renderer.render({ templateId: 'nope' }, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('extracts the distinct codes of a body', () => {
    expect(extractShortCodes('{{a}} {{ b }} {{a}} {{Manager Note}}')).toEqual(['a', 'b', 'Manager Note']);
  });
});
