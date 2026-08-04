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
  buildNestedProbeValue,
  buildSlotCapability,
  containerAnswerIsUsable,
  enumerateNestedSlots,
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
  /**
   * A real preview's values, used only to find nested slots and to supply the surrounding data of the
   * container item they sit in.
   *
   * Values are the right source here for the same reason they are wrong for shapes: the item type of
   * `cards: CardProps[]` is a named interface the registry never ships, while the preview holds an
   * actual card with an actual element in it. Nothing is inferred about *what* the slot accepts — that
   * still comes from rendering.
   */
  previewValues?: Record<string, unknown>;
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

  // Two kinds of target, probed identically once built. A top-level slot writes one prop; a nested slot
  // rebuilds its container with the candidate at one path inside it. Both end up as "props to merge
  // over the base", so the render/assert loop below never learns the difference.
  //
  // Nested slots were 48 of 180 across 8x8's catalog — real coverage was 73%, not the 84% first
  // reported — and they are where the body of a generated page lives. `image-gallery` generating three
  // images and placing none of them was exactly this: nothing had ever measured `images[].thumbnailSlot`.
  const nestedSlots = enumerateNestedSlots(input.previewValues ?? {});

  // A container prop is probed as a whole as well as field by field, and it is often the container that
  // holds the real answer.
  //
  // `image-gallery.images` is the case that forced this. Its preview items carry `thumbnailSlot` and
  // `lightboxSlot` elements, so field-by-field probing reports both unresolved and stops — technically
  // true, and useless. The component's field annotation rebuilds each item from `src` unless the slot
  // already holds an element, so what an author actually writes is `[{ src, alt }]`, and that renders.
  // The declared type never said so: `images` is `editorType: "array"`, not a slot at all.
  //
  // Only recorded when something is accepted. An unresolved container must NOT be written down, because
  // a `cards` array whose `cardSlot` takes only an element still has title and body fields an author
  // edits every day, and marking the prop uneditable would take those with it. Absence keeps the
  // existing value-derived description in play, which is the correct fallback.
  const containerProps = [...new Set(nestedSlots.filter((s) => s.container === 'array').map((s) => s.prop))]
    .filter((prop) => !isSlotProp(properties?.[prop]));

  const targets: { key: string; acceptedOnly?: boolean; props: (value: unknown) => Record<string, unknown> }[] = [
    ...Object.keys(properties ?? {})
      .filter((name) => isSlotProp(properties[name]))
      .map((name) => ({ key: name, props: (value: unknown) => ({ [name]: value }) })),
    ...containerProps.map((prop) => ({
      key: prop,
      acceptedOnly: true,
      props: (value: unknown) => ({ [prop]: value }),
    })),
    ...nestedSlots.map((slot) => ({
      key: slot.path,
      props: (value: unknown) => ({
        [slot.prop]: buildNestedProbeValue((input.previewValues ?? {})[slot.prop], slot, value),
      }),
    })),
  ];
  // No slots and no containers: nothing to measure, and the empty record is the honest answer. Distinct
  // from every path below, which is a *failure* to measure and must not be reported the same way.
  if (!targets.length) return record;

  /**
   * Give up, and say what went unmeasured.
   *
   * Naming the targets is the whole point. Without `unprobed` a bail emits `slots: {}` and
   * `unresolved: []` — indistinguishable from a component that probed perfectly — so a broken probe
   * reports green. See `ComponentCapabilities.unprobed`.
   */
  const bail = (message: string): ComponentCapabilities => {
    record.error = message;
    record.unprobed = targets.map((t) => t.key);
    return record;
  };

  const env = await setupProbeEnvironment();
  if (!env) return bail('jsdom is not installed — slots left unprobed.');

  let loaded: { mod: ComponentModule; cleanup: () => Promise<void> } | null = null;
  try {
    loaded = await loadModule(bundleSource, componentId);
  } catch (e) {
    return bail(`module failed to load: ${(e as Error)?.message?.slice(0, 160) ?? e}`);
  }

  const { mod, cleanup } = loaded;
  if (typeof mod.render !== 'function') {
    await cleanup();
    return bail('bundle exports no render() — cannot probe.');
  }

  const base = { ...baseProps(properties, componentId), ...(context ?? {}) };
  const doc = env.window.document;

  try {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!;
      const sentinel = sentinelFor(target.key, i);
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
          mod.render(host, { ...base, ...target.props(candidate.make(sentinel)) });
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

      const capability = buildSlotCapability(outcomes);
      if (target.acceptedOnly) {
        if (capability.unresolved) continue;
        // Rendering the sentinel is not enough for a container — see `containerAnswerIsUsable`. Five of
        // six answers here were lossy, and a lossy answer tells an authoring model to discard the item's
        // real fields.
        const winner = candidates.find((c) => c.name === capability.accepts[0]);
        const item = (input.previewValues ?? {})[target.key];
        if (!winner || !containerAnswerIsUsable(winner.make(sentinel), Array.isArray(item) ? item[0] : item)) continue;
      }
      record.slots[target.key] = capability;
    }
  } finally {
    await cleanup();
  }

  record.unresolved = Object.entries(record.slots)
    .filter(([, cap]) => cap.unresolved)
    .map(([name]) => name);

  return record;
}
