import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffStat, textChanged } from '../src/utils/line-diff.ts';

test('identical input is all context', () => {
  const ops = diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(ops.length, 3);
  assert.ok(ops.every((o) => o.type === 'context'));
  assert.deepEqual(diffStat(ops), { added: 0, removed: 0 });
});

test('a changed middle line shows one del + one add, context preserved', () => {
  const ops = diffLines('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(diffStat(ops), { added: 1, removed: 1 });
  // first and last lines stay as context
  assert.equal(ops[0].type, 'context');
  assert.equal(ops[ops.length - 1].type, 'context');
  // the changed line surfaces both sides
  assert.ok(ops.some((o) => o.type === 'del' && o.text === 'b'));
  assert.ok(ops.some((o) => o.type === 'add' && o.text === 'B'));
});

test('pure additions and removals', () => {
  assert.deepEqual(diffStat(diffLines('', 'x\ny')), { added: 2, removed: 0 });
  assert.deepEqual(diffStat(diffLines('x\ny', '')), { added: 0, removed: 2 });
});

test('appended lines keep the shared prefix as context', () => {
  const ops = diffLines('a\nb', 'a\nb\nc');
  assert.deepEqual(diffStat(ops), { added: 1, removed: 0 });
  assert.equal(ops.filter((o) => o.type === 'context').length, 2);
});

test('empty/empty is no ops', () => {
  assert.deepEqual(diffLines('', ''), []);
});

test('textChanged normalizes null/undefined/empty', () => {
  assert.equal(textChanged(null, ''), false);
  assert.equal(textChanged(undefined, ''), false);
  assert.equal(textChanged('a', 'a'), false);
  assert.equal(textChanged('a', 'b'), true);
  assert.equal(textChanged(null, 'b'), true);
});
