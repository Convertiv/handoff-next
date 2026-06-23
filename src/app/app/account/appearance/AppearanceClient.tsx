'use client';

import { useRef, useState, useTransition } from 'react';
import { handoffApiUrl } from '../../../lib/api-path';
import type { AppearanceSettings, LogoVariant } from '../../../lib/db/registry-queries';
import type { CssVarDescriptor, DtcgColorToken } from '../../../lib/server/appearance';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { cn } from '../../../lib/utils';

// ─── helpers (client-safe, duplicated from server/appearance) ─────────────────

function hexToHslComponents(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '0 0% 0%';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hslComponentsToHex(components: string): string {
  const parts = components.trim().split(/[\s,]+/);
  const h = parseFloat(parts[0]), s = parseFloat(parts[1]) / 100, l = parseFloat(parts[2]) / 100;
  if (isNaN(h) || isNaN(s) || isNaN(l)) return '#000000';
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const val = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * val).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Stored values are hex strings; CSS var values could be "H S% L%" from existing
// appearance settings or raw hex from user picks. Normalise to hex for the picker.
function normalizeToHex(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('#')) return value;
  // Looks like "H S% L%" components
  if (/^\d/.test(value)) return hslComponentsToHex(value);
  return value;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TokenPickerDialog({
  tokens,
  onPick,
}: {
  tokens: DtcgColorToken[];
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = tokens.filter((t) => t.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 text-xs" type="button">
          From tokens
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pick a color token</DialogTitle>
        </DialogHeader>
        <input
          type="text"
          placeholder="Search tokens…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-3 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No tokens found</p>
          )}
          {filtered.map((token) => (
            <button
              key={token.path}
              type="button"
              onClick={() => {
                onPick(token.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span
                className="h-5 w-5 shrink-0 rounded-sm border border-border/50"
                style={{ backgroundColor: token.value }}
              />
              <span className="truncate text-xs text-muted-foreground">{token.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{token.value}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  initialSettings: AppearanceSettings;
  logoVariants: LogoVariant[];
  logoSetName: string | null;
  colorTokens: DtcgColorToken[];
  fontFamilies: { key: string; name: string }[];
  cssVarDescriptors: CssVarDescriptor[];
};

export default function AppearanceClient({
  initialSettings,
  logoVariants,
  logoSetName,
  colorTokens,
  fontFamilies,
  cssVarDescriptors,
}: Props) {
  const [settings, setSettings] = useState<AppearanceSettings>(initialSettings);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>(
    () => {
      const stored = initialSettings.colorOverrides ?? {};
      // normalise any stored HSL components to hex for the picker
      return Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, normalizeToHex(v)]));
    },
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoSelect = (variantId: string) => {
    setSettings((s) => ({ ...s, logoVariantId: variantId, customLogoSvg: undefined }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const svg = ev.target?.result as string;
      setSettings((s) => ({ ...s, customLogoSvg: svg, logoVariantId: undefined }));
    };
    reader.readAsText(file);
  };

  const setColor = (variable: string, hex: string) => {
    setColorOverrides((prev) => ({ ...prev, [variable]: hex }));
  };

  const clearColor = (variable: string) => {
    setColorOverrides((prev) => {
      const next = { ...prev };
      delete next[variable];
      return next;
    });
  };

  const handleSave = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const payload: AppearanceSettings = {
        ...settings,
        colorOverrides,
      };
      const res = await fetch(handoffApiUrl('/api/handoff/admin/appearance'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Save failed');
        return;
      }
      setSuccess(true);
    });
  };

  const selectedVariant = logoVariants.find((v) => v.id === settings.logoVariantId);
  const currentLogoSvg = settings.customLogoSvg ?? selectedVariant?.svg ?? null;

  const groupedVars = {
    brand: cssVarDescriptors.filter((d) => d.group === 'brand'),
    page: cssVarDescriptors.filter((d) => d.group === 'page'),
    ui: cssVarDescriptors.filter((d) => d.group === 'ui'),
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Appearance</h1>
        <p className="text-sm text-muted-foreground">Customize the logo, colors, and typography of your Handoff site.</p>
      </div>

      {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}
      {success && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          Appearance saved. Changes will be visible within ~60 seconds (theme cache).
        </p>
      )}

      {/* ─── Logo ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Logo</h2>
          <p className="text-sm text-muted-foreground">Select a variant from your logo set or upload a custom SVG.</p>
        </div>

        {/* Current logo preview */}
        {currentLogoSvg && (
          <div className="inline-flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <div
              className="h-8 w-auto"
              dangerouslySetInnerHTML={{ __html: currentLogoSvg }}
              style={{ maxWidth: '160px' }}
            />
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, logoVariantId: undefined, customLogoSvg: undefined }))}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          </div>
        )}

        {/* Logo variants grid */}
        {logoVariants.length > 0 && (
          <div className="space-y-2">
            {logoSetName && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{logoSetName}</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {logoVariants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => handleLogoSelect(variant.id)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary',
                    settings.logoVariantId === variant.id && !settings.customLogoSvg
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border',
                  )}
                >
                  <div
                    className="flex h-10 w-full items-center justify-center"
                    dangerouslySetInnerHTML={{ __html: variant.svg }}
                    style={{ maxHeight: '40px' }}
                  />
                  <span className="text-[11px] text-muted-foreground capitalize">{variant.name ?? variant.variant}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Upload */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" type="button" onClick={() => fileInputRef.current?.click()}>
            Upload SVG
          </Button>
          {settings.customLogoSvg && (
            <span className="text-xs text-muted-foreground">Custom logo active</span>
          )}
          <input ref={fileInputRef} type="file" accept="image/svg+xml,.svg" className="hidden" onChange={handleLogoUpload} />
        </div>
      </section>

      {/* ─── Colors ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Colors</h2>
          <p className="text-sm text-muted-foreground">
            Override CSS variables used throughout the site.{' '}
            {colorTokens.length > 0 && <>Your <strong>{colorTokens.length}</strong> design tokens are available as presets.</>}
          </p>
        </div>

        {(['brand', 'page', 'ui'] as const).map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{group}</p>
            <div className="divide-y divide-border rounded-lg border">
              {groupedVars[group].map((descriptor) => {
                const currentHex = colorOverrides[descriptor.variable] ?? '';
                return (
                  <div key={descriptor.variable} className="flex items-center gap-3 px-4 py-3">
                    {/* Color swatch + native picker */}
                    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60">
                      {currentHex ? (
                        <span className="absolute inset-0" style={{ backgroundColor: currentHex }} />
                      ) : (
                        <span className="text-[9px] font-mono text-muted-foreground">–</span>
                      )}
                      <input
                        type="color"
                        value={currentHex || '#ffffff'}
                        onChange={(e) => setColor(descriptor.variable, e.target.value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        title={`Set ${descriptor.label}`}
                      />
                    </div>

                    {/* Label */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{descriptor.label}</p>
                      <p className="text-xs text-muted-foreground">{descriptor.description}</p>
                    </div>

                    {/* Hex input */}
                    <input
                      type="text"
                      value={currentHex}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColor(descriptor.variable, v);
                      }}
                      placeholder="–"
                      className="w-24 rounded-md border border-input bg-background px-2 py-1 text-center font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                    />

                    {/* Token picker */}
                    {colorTokens.length > 0 && (
                      <TokenPickerDialog tokens={colorTokens} onPick={(hex) => setColor(descriptor.variable, hex)} />
                    )}

                    {/* Clear */}
                    {currentHex && (
                      <button
                        type="button"
                        onClick={() => clearColor(descriptor.variable)}
                        className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ─── Typography ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Typography</h2>
          <p className="text-sm text-muted-foreground">
            Override the UI and mono font families. Only fonts pushed to the registry are listed.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="font-sans">UI font (--font-sans)</Label>
            <Select
              value={settings.fontSans ?? '__default__'}
              onValueChange={(v) => setSettings((s) => ({ ...s, fontSans: v === '__default__' ? undefined : v }))}
            >
              <SelectTrigger id="font-sans">
                <SelectValue placeholder="Default (Inter)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default (Inter)</SelectItem>
                {fontFamilies.map((f) => (
                  <SelectItem key={f.key} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="font-mono">Mono font (--font-mono)</Label>
            <Select
              value={settings.fontMono ?? '__default__'}
              onValueChange={(v) => setSettings((s) => ({ ...s, fontMono: v === '__default__' ? undefined : v }))}
            >
              <SelectTrigger id="font-mono">
                <SelectValue placeholder="Default (Geist Mono)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default (Geist Mono)</SelectItem>
                {fontFamilies.map((f) => (
                  <SelectItem key={f.key} value={f.name}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* ─── Save ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-t pt-6">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Changes apply site-wide within ~60 seconds via the theme cache.
        </p>
      </div>
    </div>
  );
}
