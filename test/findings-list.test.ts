import assert from 'node:assert';
import { describe, it } from 'node:test';
import { checkGuardrails, blockingFindings } from '../src/app/lib/authoring-guardrails';

/**
 * The shape contract between the gate and the list — roadmap E.11.
 *
 * `FindingsList` is a React component, so this does not render it; it pins the thing that would silently break it:
 * that a real blocking finding carries the three fields the list reads (`message`, `path`, `blockIndex`) and a
 * severity it can sort on. The regression this guards is a producer quietly dropping `blockIndex`, which would turn
 * every row from "Block 2 · Logo" into unplaceable text and disable the jump.
 */
describe('findings carry what the UI needs to place them', () => {
  const findings = blockingFindings(
    checkGuardrails(
      [
        // Block 0 is valid apart from nothing — it must not contribute a `required` finding of its own.
        { id: 'hero', args: { title: 'ok', logo: { src: 'https://cdn.example/a.svg', alt: 'Logo' } } },
        { id: 'hero', args: { title: 'x'.repeat(200), logo: { src: '', alt: 'Logo' } } },
      ],
      [],
      {},
      { hero: { logo: { required: true }, title: { maxLength: 80 } } }
    )
  );

  it('reports the block a finding belongs to, zero-based', () => {
    const placed = findings.filter((f) => typeof f.blockIndex === 'number');
    assert.ok(placed.length >= 2, 'expected more than one finding');
    // Both belong to block 1; block 0 is clean, which is itself the point.
    assert.deepEqual([...new Set(placed.map((f) => f.blockIndex))], [1]);
  });

  it('reports a field path and a human label for every field-level finding', () => {
    for (const f of findings) {
      assert.equal(typeof f.path, 'string', `no path on ${f.code}`);
      assert.ok(f.label && f.label.length > 0, `no label on ${f.code}`);
    }
  });

  it('marks every blocking finding as blocking, so the list can sort them first', () => {
    assert.ok(findings.length > 0);
    assert.ok(findings.every((f) => f.severity === 'blocking'));
  });

  /** The required finding for block 1 must name the field, not just say something is missing. */
  it('names the offending field in the message', () => {
    const required = findings.find((f) => f.code === 'required-empty');
    assert.ok(required, 'expected a required finding');
    assert.match(required.message, /Logo is required/);
    assert.equal(required.blockIndex, 1);
  });
});
