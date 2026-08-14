import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideRename, isPlaceholderTitle } from '../src/app/lib/page-title';

describe('decideRename', () => {
  it('accepts a real new name', () => {
    const d = decideRename({ recordId: 'page-abc', current: 'Untitled page', draft: 'Pricing' });
    assert.deepEqual(d, { rename: true, title: 'Pricing' });
  });

  it('trims before deciding, so trailing space is not a change', () => {
    const d = decideRename({ recordId: 'page-abc', current: 'Pricing', draft: '  Pricing  ' });
    assert.deepEqual(d, { rename: false, reason: 'unchanged' });
  });

  it('trims the name it does write', () => {
    const d = decideRename({ recordId: 'page-abc', current: 'Pricing', draft: '  Pricing v2  ' });
    assert.deepEqual(d, { rename: true, title: 'Pricing v2' });
  });

  it('refuses an empty name rather than blanking the card', () => {
    for (const draft of ['', '   ', '\n\t']) {
      const d = decideRename({ recordId: 'page-abc', current: 'Pricing', draft });
      assert.deepEqual(d, { rename: false, reason: 'empty' }, `draft ${JSON.stringify(draft)}`);
    }
  });

  it('refuses before the record exists — save-on-first-block has not run yet', () => {
    const d = decideRename({ recordId: null, current: '', draft: 'Pricing' });
    assert.deepEqual(d, { rename: false, reason: 'no-record' });
  });

  it('lets a page be renamed away from the placeholder and back', () => {
    const away = decideRename({ recordId: 'p', current: 'Untitled page', draft: 'Careers' });
    assert.equal(away.rename, true);
    const back = decideRename({ recordId: 'p', current: 'Careers', draft: 'Untitled page' });
    assert.equal(back.rename, true, 'the placeholder is not a reserved word');
  });
});

describe('isPlaceholderTitle', () => {
  it('recognises what the app names a record it just created', () => {
    assert.equal(isPlaceholderTitle('Untitled page'), true);
    assert.equal(isPlaceholderTitle('Untitled template'), true);
    assert.equal(isPlaceholderTitle('  untitled PAGE '), true, 'case and padding are incidental');
  });

  it('does not claim a chosen name that merely starts with the word', () => {
    assert.equal(isPlaceholderTitle('Untitled Draft Notes'), false);
    assert.equal(isPlaceholderTitle('Pricing'), false);
    assert.equal(isPlaceholderTitle(''), false);
  });
});
