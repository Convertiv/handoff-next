import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FieldGuardrailsProvider,
  useFieldGuardrails,
} from '../src/app/components/Playground/FieldGuardrailsContext';

/**
 * Guards the two things that broke when the brief's content limits were first surfaced in the block editor.
 *
 * The limits are read by `TextField`, which renders in three places: the playground, the guest build editor,
 * and the component workbench dialog in the docs. Only the first two have a `PlaygroundProvider`.
 */
describe('field guardrails context', () => {
  /**
   * The first attempt read the limits from `usePlayground()`, which **throws** outside its provider — so the
   * workbench dialog in the component docs would have crashed the moment it opened a text field.
   */
  it('has no limits outside a provider, rather than throwing', () => {
    function Probe() {
      const guardrails = useFieldGuardrails();
      return createElement('span', null, JSON.stringify(guardrails));
    }
    const html = renderToStaticMarkup(createElement(Probe));
    assert.equal(html, '<span>{}</span>');
  });

  it('exposes the config it is given', () => {
    function Probe() {
      const guardrails = useFieldGuardrails();
      return createElement('span', null, String(guardrails.fields?.['title']?.maxLength));
    }
    const html = renderToStaticMarkup(
      createElement(FieldGuardrailsProvider, {
        value: { fields: { title: { maxLength: 40 } } },
        children: createElement(Probe),
      })
    );
    assert.equal(html, '<span>40</span>');
  });

  /**
   * The field layer must not reach server code. Reading the limits from `PlaygroundContext` pulled in
   * `@/app/actions/patterns` — server actions, and therefore `server-only` — which made *every* importer of
   * `renderFormFields` fail to load at all. Keeping this assertion here states the boundary explicitly; the
   * symptom otherwise surfaces as an unrelated-looking crash in whichever test imports a field first.
   */
  it('leaves the field module graph free of server-only code', async () => {
    const mod = await import('../src/app/components/Playground/fields/Field');
    assert.equal(typeof mod.toArrayItems, 'function');
  });
});
