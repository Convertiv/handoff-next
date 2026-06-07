/**
 * Contrast validator (#51).
 *
 * Walks visible text nodes in the rendered preview and computes WCAG contrast
 * ratios against their effective background. Emits a finding when a ratio
 * falls below the configured threshold.
 *
 * Why our own implementation when axe already checks contrast? Two reasons:
 *  1. We want results even when projects opt out of axe entirely.
 *  2. We can compare ratios against project-specific thresholds (e.g. enforce
 *     AAA on brand text only) — granularity axe doesn't expose.
 *
 * The math lives in a single page.evaluate() so the page does the per-node
 * computed-style work; we just receive plain JSON findings.
 */

import type { Validator, ValidatorInput, ValidatorResult, ValidationFinding } from '@handoff/types/validation';
import { openPreviewPage } from '@handoff/transformers/preview/component/playwright-shared';

export type ContrastSpec = 'wcag-aa' | 'wcag-aaa';

export interface ContrastOptions {
  /**
   * Conformance level. wcag-aa requires 4.5:1 for normal text and 3:1 for
   * large; wcag-aaa requires 7:1 and 4.5:1 respectively. Default: 'wcag-aa'.
   */
  spec?: ContrastSpec;
  /** Override the normal-text ratio threshold. Falsy → derived from spec. */
  normalTextRatio?: number;
  /** Override the large-text ratio threshold. Falsy → derived from spec. */
  largeTextRatio?: number;
  /** Pixel size at which a text node is considered "large" (without bold). Default: 24. */
  largeTextSizePx?: number;
  /** Pixel size at which BOLD text is considered "large". Default: 18.66 (14pt). */
  largeBoldSizePx?: number;
}

interface RawFinding {
  ratio: number;
  required: number;
  isLarge: boolean;
  fontSize: number;
  fontWeight: string;
  fg: string;
  bg: string;
  selector: string;
  textSnippet: string;
}

function thresholdsFor(spec: ContrastSpec): { normal: number; large: number } {
  return spec === 'wcag-aaa' ? { normal: 7, large: 4.5 } : { normal: 4.5, large: 3 };
}

export function contrast(opts: ContrastOptions = {}): Validator {
  const spec: ContrastSpec = opts.spec ?? 'wcag-aa';
  const baseThresholds = thresholdsFor(spec);
  const normal = opts.normalTextRatio ?? baseThresholds.normal;
  const large = opts.largeTextRatio ?? baseThresholds.large;
  const largeSize = opts.largeTextSizePx ?? 24;
  const largeBoldSize = opts.largeBoldSizePx ?? 18.66;

  return {
    id: 'contrast',
    name: 'Contrast',
    description: 'Runtime WCAG color-contrast checks on rendered preview text.',
    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
    async run(input: ValidatorInput): Promise<ValidatorResult> {
      const startedAt = Date.now();

      if (!input.previewPath) {
        return {
          validatorId: 'contrast',
          validatorName: 'Contrast',
          status: 'fail',
          severity: 'error',
          findings: [
            {
              ruleId: 'contrast.runtime-error',
              severity: 'error',
              message: 'No preview HTML on disk — run `handoff-app build:components` first.',
            },
          ],
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
      }

      const opened = await openPreviewPage({
        workingPath: input.workingPath,
        previewPath: input.previewPath,
      });
      if ('error' in opened) {
        return {
          validatorId: 'contrast',
          validatorName: 'Contrast',
          status: 'fail',
          severity: 'error',
          findings: [{ ruleId: 'contrast.runtime-error', severity: 'error', message: opened.error }],
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
      }

      try {
        const raw = await opened.page.evaluate(
          ({ normal, large, largeSize, largeBoldSize }) => {
            // ---- in-page helpers ----------------------------------------
            function parseRgb(s: string): [number, number, number, number] | null {
              const m = s.match(/^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?))?\s*\)$/);
              if (!m) return null;
              return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] != null ? parseFloat(m[4]) : 1];
            }
            // Composite a possibly-transparent foreground over a background.
            function composite(
              fg: [number, number, number, number],
              bg: [number, number, number, number]
            ): [number, number, number, number] {
              const a = fg[3] + bg[3] * (1 - fg[3]);
              if (a === 0) return [0, 0, 0, 0];
              return [
                (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
                (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
                (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
                a,
              ];
            }
            function luminance(r: number, g: number, b: number): number {
              const [R, G, B] = [r, g, b].map((c) => {
                const s = c / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
              });
              return 0.2126 * R + 0.7152 * G + 0.0722 * B;
            }
            function contrastRatio(a: [number, number, number, number], b: [number, number, number, number]): number {
              const la = luminance(a[0], a[1], a[2]);
              const lb = luminance(b[0], b[1], b[2]);
              const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
              return (lighter + 0.05) / (darker + 0.05);
            }
            function effectiveBg(el: Element): [number, number, number, number] {
              // Walk up ancestors compositing background-color until we hit an
              // opaque layer. Reasonable approximation — doesn't account for
              // background-image or sibling overlap.
              let cur: Element | null = el;
              let stack: [number, number, number, number][] = [];
              while (cur && cur !== document.documentElement) {
                const cs = getComputedStyle(cur);
                const bg = parseRgb(cs.backgroundColor);
                if (bg && bg[3] > 0) {
                  stack.push(bg);
                  if (bg[3] >= 1) break;
                }
                cur = cur.parentElement;
              }
              // Default body bg = white if everything was transparent
              let acc: [number, number, number, number] = [255, 255, 255, 1];
              for (let i = stack.length - 1; i >= 0; i--) {
                acc = composite(stack[i], acc);
              }
              return acc;
            }
            function selectorOf(el: Element): string {
              if (el.id) return `#${el.id}`;
              const parts: string[] = [];
              let cur: Element | null = el;
              while (cur && cur !== document.documentElement && parts.length < 4) {
                let part = cur.tagName.toLowerCase();
                const cls = (cur.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
                if (cls.length) part += '.' + cls.join('.');
                parts.unshift(part);
                cur = cur.parentElement;
              }
              return parts.join(' > ');
            }
            function hasVisibleText(el: Element): boolean {
              for (const node of Array.from(el.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0) return true;
              }
              return false;
            }
            function isVisible(el: Element): boolean {
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
              const rect = (el as HTMLElement).getBoundingClientRect?.();
              if (!rect) return true;
              return rect.width > 0 && rect.height > 0;
            }
            function rgbToHex(c: [number, number, number, number]): string {
              const to2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
              return `#${to2(c[0])}${to2(c[1])}${to2(c[2])}`;
            }

            // ---- walk text-bearing elements -----------------------------
            const findings: RawFinding[] = [];
            const all = document.querySelectorAll('body *');
            for (const el of Array.from(all)) {
              if (!hasVisibleText(el)) continue;
              if (!isVisible(el)) continue;
              const cs = getComputedStyle(el);
              const fg = parseRgb(cs.color);
              if (!fg) continue;
              const bg = effectiveBg(el);
              const fgOnBg = composite(fg, bg);
              const ratio = contrastRatio(fgOnBg, bg);
              const fontSize = parseFloat(cs.fontSize) || 16;
              const fontWeight = cs.fontWeight;
              const weightNum = parseInt(fontWeight, 10) || (fontWeight === 'bold' ? 700 : 400);
              const isLarge = fontSize >= largeSize || (weightNum >= 700 && fontSize >= largeBoldSize);
              const required = isLarge ? large : normal;
              if (ratio + 0.005 < required) {
                const text = (el.textContent ?? '').trim().slice(0, 80);
                findings.push({
                  ratio: Math.round(ratio * 100) / 100,
                  required,
                  isLarge,
                  fontSize: Math.round(fontSize * 10) / 10,
                  fontWeight: String(weightNum),
                  fg: rgbToHex(fgOnBg),
                  bg: rgbToHex(bg),
                  selector: selectorOf(el),
                  textSnippet: text,
                });
              }
            }
            return findings;
          },
          { normal, large, largeSize, largeBoldSize }
        );

        const findings: ValidationFinding[] = raw.map((r) => ({
          ruleId: 'contrast.text-min-ratio',
          severity: 'error',
          message: `Contrast ratio ${r.ratio}:1 is below the ${r.required}:1 threshold for ${r.isLarge ? 'large' : 'normal'} text (${r.fg} on ${r.bg}, ${r.fontSize}px / weight ${r.fontWeight}).`,
          target: r.selector,
          snippet: r.textSnippet,
          tags: [spec],
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
        }));

        const severity = findings.length > 0 ? 'error' : 'pass';
        return {
          validatorId: 'contrast',
          validatorName: 'Contrast',
          status: severity === 'pass' ? 'pass' : 'fail',
          severity,
          findings,
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          summary:
            findings.length === 0
              ? `All text meets ${spec.toUpperCase()} contrast thresholds.`
              : `${findings.length} text node(s) below ${spec.toUpperCase()} threshold.`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          validatorId: 'contrast',
          validatorName: 'Contrast',
          status: 'fail',
          severity: 'error',
          findings: [{ ruleId: 'contrast.runtime-error', severity: 'error', message: msg }],
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
      } finally {
        await opened.close();
      }
    },
  };
}
