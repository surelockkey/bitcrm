import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { BusinessMetricsService } from '@bitcrm/shared';
import type { Browser, HTTPRequest } from 'puppeteer-core';

const KNOWN_EXECUTABLES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

/**
 * Where Chrome lives: `PUPPETEER_EXECUTABLE_PATH` (the container sets it to
 * Alpine's chromium), else a known local install. No browser → 503, so a
 * developer machine without Chrome still serves everything except PDFs.
 */
export function resolveChromeExecutable(
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): string {
  const configured = env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
    if (exists(configured)) return configured;
    throw new ServiceUnavailableException(
      `PDF rendering unavailable: PUPPETEER_EXECUTABLE_PATH (${configured}) does not exist`,
    );
  }
  const found = KNOWN_EXECUTABLES.find((p) => exists(p));
  if (found) return found;
  throw new ServiceUnavailableException(
    'PDF rendering unavailable: no Chrome/Chromium found (set PUPPETEER_EXECUTABLE_PATH)',
  );
}

/**
 * Headless-Chromium HTML → PDF. One lazily launched browser shared by every
 * render, at most `BILLING_PDF_CONCURRENCY` pages at a time, each isolated:
 * JavaScript off and every request except `data:` URIs aborted, so a
 * template can never make the server fetch anything.
 */
@Injectable()
export class PdfService implements OnApplicationShutdown {
  private readonly logger = new Logger(PdfService.name);
  private browser: Promise<Browser> | null = null;
  private readonly maxConcurrent = Math.max(1, Number(process.env.BILLING_PDF_CONCURRENCY) || 3);
  private readonly timeoutMs = Math.max(1000, Number(process.env.BILLING_PDF_TIMEOUT_MS) || 20_000);
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(@Optional() private readonly metrics?: BusinessMetricsService) {}

  async render(html: string, kind: string): Promise<Buffer> {
    const done = this.metrics?.pdfRenderDuration?.startTimer({ kind });
    await this.acquire();
    try {
      const buffer = await this.withTimeout(this.renderPage(html), this.timeoutMs);
      this.metrics?.pdfRenders?.inc({ kind, status: 'success' });
      return buffer;
    } catch (err) {
      this.metrics?.pdfRenders?.inc({ kind, status: 'error' });
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`PDF render failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('PDF rendering failed — try again');
    } finally {
      this.release();
      done?.();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const pending = this.browser;
    this.browser = null;
    if (!pending) return;
    try {
      const browser = await pending;
      await browser.close();
    } catch {
      // already gone
    }
  }

  private async renderPage(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req: HTTPRequest) => {
        if (req.url().startsWith('data:')) void req.continue();
        else void req.abort('blockedbyclient');
      });
      // puppeteer 24's setContent only accepts load/domcontentloaded; with
      // JS off and only data: URIs allowed, `load` means every image is in.
      await page.setContent(html, { waitUntil: 'load', timeout: this.timeoutMs });
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        timeout: this.timeoutMs,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const executablePath = resolveChromeExecutable();
      this.browser = import('puppeteer-core')
        .then((puppeteer) =>
          puppeteer.launch({
            executablePath,
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
          }),
        )
        .then((browser) => {
          browser.on('disconnected', () => {
            this.logger.warn('PDF browser disconnected; will relaunch on next render');
            this.browser = null;
          });
          this.logger.log(`PDF browser launched (${executablePath})`);
          return browser;
        })
        .catch((err: Error) => {
          this.browser = null;
          this.logger.error(`PDF browser launch failed: ${err.message}`);
          throw new ServiceUnavailableException('PDF rendering unavailable: the browser could not start');
        });
    }
    return this.browser;
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(() => {
      this.active++;
      resolve();
    }));
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF render timed out after ${ms}ms`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }
}
