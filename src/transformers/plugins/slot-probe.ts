/**
 * Render a built component with sentinel values and record which encodings its slots actually accept.
 *
 * A `React.ReactNode` prop is opaque to type extraction — it means "anything renderable" — so the shape
 * an editor must write has been guessed, declared, or regexed from a field name, and has been wrong
 * every time. This asks the component instead: write a uniquely identifiable value, render, and look for
 * it in the DOM. See `docs/SLOT-PROBING.md`.
 *
 * Runs in Node against jsdom. The client bundle is self-contained ESM with its own React, so a DOM is
 * the only requirement — no browser, ~4ms per render, ~6s for a 50-component catalog.
 *
 * **Never fails a build.** A component that cannot be probed yields a record carrying the reason; the
 * build continues and the slots are reported as unresolved rather than silently assumed fine.
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import {
  PROBE_CANDIDATES,
  baseProps,
  buildSlotCapability,
  isSlotProp,
  sentinelFor,
  type ComponentCapabilities,
  type ProbeCandidate,
  type ProbeRoot,
  type PropertyMeta,
  type SlotCapability,
} from './slot-probe-candidates';

export type { ComponentCapabilities, SlotCapability };

/** How long to let React settle after a render before reading the DOM. */
const SETTLE_MS = 4;

interface ProbeEnvironment {
  window: {
    document: Document;
    [key: string]: unknown;
  };
  /** Set by the trap when React errors asynchronously; read and cleared per candidate. */
  takeError(): string | null;
}

let cachedEnv: ProbeEnvironment | null = null;

/**
 * Install a DOM and the globals a component library expects, once per process.
 *
 * These must exist *before* a module is imported, because the bundled React reads them at module scope.
 * jsdom ships none of `IntersectionObserver`, `ResizeObserver` or `matchMedia`, and components reach for
 * all three.
 *
 * `matchMedia` is the one with teeth: it always reports `matches: false`, so a component that branches
 * in JavaScript on a media query is probed at one synthetic viewport only. CSS-driven responsive layout
 * is unaffected — a `hidden lg:block` wrapper still puts its children in the DOM.
 */
export async function setupProbeEnvironment(): Promise<ProbeEnvironment | null> {
  if (cachedEnv) return cachedEnv;

  let JSDOM: typeof import('jsdom').JSDOM;
  let VirtualConsole: typeof import('jsdom').VirtualConsole;
  try {
    ({ JSDOM, VirtualConsole } = await import('jsdom'));
  } catch {
    return null;
  }

  /**
   * A silent console, deliberately.
   *
   * Rejection is the probe's normal output: most candidates are *meant* to fail, and React logs a
   * stack trace for every one. jsdom forwards those to stderr by default, so a healthy probe of a
   * 60-component catalog printed hundreds of "Minified React error #31" traces during `push:all` and
   * buried whatever the push actually reported. Errors are not being discarded — the trap below
   * captures them and attributes each to the candidate in flight, which is the only place the
   * information is useful.
   */
  const virtualConsole = new VirtualConsole();

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://probe.invalid/',
    virtualConsole,
  });
  const w = dom.window as unknown as Record<string, unknown>;

  const g = globalThis as unknown as Record<string, unknown>;

  /**
   * Plain assignment is not enough. Node defines some of these on `globalThis` itself — `navigator` is
   * getter-only from Node 21 — so `g.navigator = …` throws and takes the build with it. Redefine where
   * assignment fails, and treat a global we cannot install as non-fatal: the component may not need it,
   * and a missing stub shows up honestly as an unresolved slot rather than a crashed build.
   */
  const installGlobal = (key: string, value: unknown) => {
    try {
      g[key] = value;
    } catch {
      try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      } catch {
        // Leave it. Nothing here is worth failing a build over.
      }
    }
  };

  for (const key of [
    'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DocumentFragment',
    'getComputedStyle', 'CustomEvent', 'Event', 'MutationObserver', 'SVGElement', 'Image', 'DOMParser',
  ]) {
    if (w[key] !== undefined) installGlobal(key, w[key]);
  }
  installGlobal('self', w);
  installGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0));
  installGlobal('cancelAnimationFrame', (id: unknown) => clearTimeout(id as NodeJS.Timeout));

  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  w.IntersectionObserver = NoopObserver;
  w.ResizeObserver = NoopObserver;
  w.scrollTo = () => {};
  installGlobal('IntersectionObserver', NoopObserver);
  installGlobal('ResizeObserver', NoopObserver);
  installGlobal('scrollTo', () => {});
  const mql = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return false; },
  });
  w.matchMedia = mql;
  installGlobal('matchMedia', mql);

  // React 18 renders concurrently, so a render error surfaces *after* the synchronous call returns and
  // escapes any try/catch around it. Untrapped it reaches the process as an uncaught exception and kills
  // the whole build. "Did it throw" is half the probe's signal, so this is not merely defensive.
  let pending: string | null = null;
  const capture = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    pending = msg.slice(0, 200);
  };
  process.on('uncaughtException', capture);
  process.on('unhandledRejection', capture);
  (dom.window as unknown as { addEventListener: (t: string, cb: (e: { message?: string }) => void) => void })
    .addEventListener('error', (e) => capture(e?.message ?? 'window error'));

  cachedEnv = {
    window: dom.window as unknown as ProbeEnvironment['window'],
    takeError() {
      const e = pending;
      pending = null;
      return e;
    },
  };
  return cachedEnv;
}

interface ComponentModule {
  render?: (container: unknown, props: unknown) => void;
}

/**
 * Load a client bundle as a module.
 *
 * Written to a temp file rather than imported as a `data:` URL — bundles run to megabytes and data URLs
 * hit size limits. The unique filename also keeps Node's module cache from returning a previous
 * component's module.
 */
async function loadModule(bundleSource: string, componentId: string): Promise<{ mod: ComponentModule; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-probe-'));
  const file = path.join(dir, `${componentId}.mjs`);
  await fs.writeFile(file, bundleSource, 'utf-8');
  const mod = (await import(pathToFileURL(file).href)) as ComponentModule;
  return { mod, cleanup: () => fs.remove(dir).catch(() => undefined) };
}

/**
 * Probe every `ReactNode` slot on one component.
 *
 * **Per slot, never batched.** Setting every slot at once is measurably not equivalent: on
 * `hero-background` it made `buttonSlots` report rejection for an encoding it demonstrably accepts,
 * because the slots interfere. Probing one at a time is only affordable because a render is ~4ms, and
 * it is the difference between a record that is fast and one that is right.
 */
export async function probeComponent(input: {
  componentId: string;
  /** The built `-client.mjs` source. */
  bundleSource: string;
  properties: Record<string, PropertyMeta>;
  /**
   * Extra props needed before a slot renders at all — a carousel's body needs a slide to exist. The one
   * declarative escape hatch, and only ever written for slots a probe reported unresolved.
   */
  context?: Record<string, unknown>;
  candidates?: ProbeCandidate[];
}): Promise<ComponentCapabilities> {
  const { componentId, bundleSource, properties, context } = input;
  const candidates = input.candidates ?? PROBE_CANDIDATES;
  const record: ComponentCapabilities = {
    componentId,
    candidates: candidates.map((c) => c.name),
    slots: {},
    unresolved: [],
  };

  const slots = Object.keys(properties ?? {}).filter((name) => isSlotProp(properties[name]));
  if (!slots.length) return record;

  const env = await setupProbeEnvironment();
  if (!env) {
    record.error = 'jsdom is not installed — slots left unprobed.';
    return record;
  }

  let loaded: { mod: ComponentModule; cleanup: () => Promise<void> } | null = null;
  try {
    loaded = await loadModule(bundleSource, componentId);
  } catch (e) {
    record.error = `module failed to load: ${(e as Error)?.message?.slice(0, 160) ?? e}`;
    return record;
  }

  const { mod, cleanup } = loaded;
  if (typeof mod.render !== 'function') {
    await cleanup();
    record.error = 'bundle exports no render() — cannot probe.';
    return record;
  }

  const base = { ...baseProps(properties, componentId), ...(context ?? {}) };
  const doc = env.window.document;

  try {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const sentinel = sentinelFor(slot, i);
      const outcomes: { candidate: ProbeCandidate; accepted: boolean; threw: boolean }[] = [];

      for (const candidate of candidates) {
        const host = doc.createElement('div');
        doc.body.appendChild(host);
        env.takeError();

        // Silence the console for the render window only.
        //
        // Rejection is the probe's normal output — most candidates are *meant* to fail — and React logs
        // a full stack trace for each. The bundled React writes to Node's global console rather than
        // jsdom's, so a `VirtualConsole` does not stop it, and a healthy probe of a 60-component catalog
        // printed hundreds of "Minified React error #31" traces during `push:all` and buried what the
        // push actually reported. Nothing is lost: the trap already captures these and attributes each
        // to the candidate in flight. Restored immediately so genuine build output is never hidden.
        const realError = console.error;
        const realWarn = console.warn;
        console.error = () => {};
        console.warn = () => {};

        let threw = false;
        try {
          mod.render(host, { ...base, [slot]: candidate.make(sentinel) });
          await new Promise((r) => setTimeout(r, SETTLE_MS));
        } catch {
          threw = true;
        } finally {
          console.error = realError;
          console.warn = realWarn;
        }
        if (env.takeError()) threw = true;

        const accepted = threw ? false : candidate.check(host as unknown as ProbeRoot, sentinel);
        outcomes.push({ candidate, accepted, threw });
        host.remove();
      }

      record.slots[slot] = buildSlotCapability(outcomes);
    }
  } finally {
    await cleanup();
  }

  record.unresolved = Object.entries(record.slots)
    .filter(([, cap]) => cap.unresolved)
    .map(([name]) => name);

  return record;
}
