import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomFieldValue } from '@bitcrm/types';
import { MessageTemplatesRepository } from './message-templates.repository';
import { ContextLoader } from './context-loader';
import { htmlToText, looksLikeHtml } from './html-text';
import { resolveShortCode } from './short-codes';
import type { RenderContext, RenderRefs } from './render-context';

export type RenderFormat = 'text' | 'html';

export interface RenderInput {
  /** Render a stored template … */
  templateId?: string;
  /** … or this body (wins over the template's when both are given — an edited draft). */
  body?: string;
  subject?: string;
  /** Default: `text` (SMS), or `html` when the template's channel is `email`. */
  format?: RenderFormat;
  /** Leave `{{code}}` in place for codes that did not resolve instead of blanking them. */
  keepMissing?: boolean;
}

export interface RenderResult {
  body: string;
  subject?: string;
  /** Codes that resolved to nothing, in order of first appearance, deduplicated. */
  missing: string[];
}

/** `{{ code }}` — whitespace inside the braces tolerated; custom-field names may contain spaces. */
export const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractShortCodes(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const code = match[1].trim();
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function customFieldToString(value: CustomFieldValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Renders `{{short_code}}` templates (design §7.1 `render`, M11).
 *
 * Contract for the outbound path (`SendMessageDto.templateId`):
 *
 *   render({ templateId?, body?, subject?, format?, keepMissing? },
 *          { conversationId?, contactId?, dealId?, userId?, values? })
 *     → { body, subject?, missing }
 *
 * The loader turns the ids into a `RenderContext` (CRM contact, deal + its
 * catalogs and custom fields, technician, settings); `renderWithContext` is
 * the pure half a preview with inline sample data uses directly.
 *
 * Resolution order per code: `ctx.values` → registry (`short-codes.ts`) →
 * deal custom field by name (case-insensitive). Anything else is `missing`
 * and rendered empty (or kept verbatim with `keepMissing`) — the caller
 * decides whether a missing value blocks the send.
 */
@Injectable()
export class TemplateRenderer {
  constructor(
    private readonly templates: MessageTemplatesRepository,
    private readonly contextLoader: ContextLoader,
  ) {}

  async render(input: RenderInput, refs: RenderRefs): Promise<RenderResult> {
    const template = input.templateId ? await this.templates.get(input.templateId) : null;
    if (input.templateId && !template) {
      throw new NotFoundException(`Message template ${input.templateId} not found`);
    }
    const ctx = await this.contextLoader.load(refs);
    return this.renderWithContext(
      {
        body: input.body ?? template?.messageTemplate ?? '',
        subject: input.subject ?? template?.messageSubjectTemplate,
        format: input.format ?? (template?.channel === 'email' ? 'html' : 'text'),
        keepMissing: input.keepMissing,
      },
      ctx,
    );
  }

  renderWithContext(
    input: { body: string; subject?: string; format?: RenderFormat; keepMissing?: boolean },
    ctx: RenderContext,
  ): RenderResult {
    const format = input.format ?? 'text';
    const missing: string[] = [];
    const fill = (text: string, escape: (s: string) => string) =>
      text.replace(PLACEHOLDER, (placeholder, raw: string) => {
        const code = raw.trim();
        const value = this.resolve(code, ctx);
        if (value !== undefined) return escape(value);
        if (!missing.includes(code)) missing.push(code);
        return input.keepMissing ? placeholder : '';
      });

    // Strip markup BEFORE substituting so a value is never mistaken for a tag.
    const source = format === 'text' && looksLikeHtml(input.body) ? htmlToText(input.body) : input.body;
    const body = fill(source, format === 'html' ? escapeHtml : (s) => s);
    const subject = input.subject === undefined ? undefined : fill(htmlToText(input.subject), (s) => s);
    return { body, subject, missing };
  }

  private resolve(code: string, ctx: RenderContext): string | undefined {
    const override = ctx.values?.[code];
    if (override !== undefined && override !== '') return override;

    const standard = resolveShortCode(code, ctx);
    if (standard !== undefined && standard !== '') return standard;

    if (ctx.customFields) {
      const wanted = code.toLowerCase();
      for (const [name, value] of Object.entries(ctx.customFields)) {
        if (name.trim().toLowerCase() !== wanted) continue;
        if (value === undefined || value === null || value === '') return undefined;
        return customFieldToString(value);
      }
    }
    return undefined;
  }
}
