import assert from 'node:assert';
import { describe, it } from 'node:test';
import { rootCause, stripPayloads, summarizeError } from '../src/app/lib/error-summary';

/** The real shape: Drizzle wraps the driver error and inlines every bound parameter. */
function drizzleImageWriteError() {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAABgAAAAQACAIAAACoEwUV' + 'A'.repeat(4000);
  const cause = Object.assign(new Error('insert or update on table "handoff_asset_blob" violates foreign key constraint "handoff_asset_blob_asset_id_handoff_asset_id_fk"'), {
    code: '23503',
    detail: 'Key (asset_id)=(img_1c5a47cafa8a) is not present in table "handoff_asset".',
  });
  return Object.assign(
    new Error(
      `Failed query: insert into "handoff_asset_blob" ("asset_id", "data") values ($1, $2)\nparams: img_1c5a47cafa8a,${base64}`
    ),
    { cause }
  );
}

describe('summarizeError', () => {
  it('surfaces the constraint instead of the image, which is the whole point', () => {
    const summary = summarizeError(drizzleImageWriteError());
    assert.match(summary, /violates foreign key constraint/);
    assert.ok(!summary.includes('iVBORw0KGgo'), 'base64 payload must not survive');
    assert.ok(summary.length <= 600);
  });

  it('keeps the query for context, since the cause alone does not name it', () => {
    assert.match(summarizeError(drizzleImageWriteError()), /handoff_asset_blob/);
  });

  it('does not truncate away the diagnosis when the wrapper is enormous', () => {
    // The original bug: clipping the wrapper's message to N chars kept only base64.
    const summary = summarizeError(drizzleImageWriteError(), 200);
    assert.match(summary, /foreign key/);
  });

  it('handles a plain error, a string, and nothing at all', () => {
    assert.equal(summarizeError(new Error('boom')), 'boom');
    assert.equal(summarizeError('boom'), 'boom');
    assert.equal(summarizeError(undefined), 'Unknown error');
    assert.equal(summarizeError(new Error('')), 'Unknown error');
  });

  it('reads message/detail/constraint off a non-Error driver object', () => {
    const summary = summarizeError({ message: 'duplicate key', constraint: 'handoff_asset_pkey' });
    assert.match(summary, /duplicate key/);
    assert.match(summary, /handoff_asset_pkey/);
  });

  it('does not repeat the cause when the wrapper already contains it', () => {
    const cause = new Error('deadlock detected');
    const err = Object.assign(new Error('deadlock detected'), { cause });
    assert.equal(summarizeError(err), 'deadlock detected');
  });
});

describe('rootCause', () => {
  it('walks to the deepest cause', () => {
    const deep = new Error('driver said no');
    const mid = Object.assign(new Error('orm'), { cause: deep });
    const top = Object.assign(new Error('route'), { cause: mid });
    assert.equal(rootCause(top), deep);
  });

  it('terminates on a self-referential chain rather than spinning', () => {
    const err = new Error('loop') as Error & { cause?: unknown };
    err.cause = err;
    assert.equal(rootCause(err), err);
  });

  it('returns the error itself when there is no cause', () => {
    const err = new Error('alone');
    assert.equal(rootCause(err), err);
  });
});

describe('stripPayloads', () => {
  it('drops everything from `params:` on', () => {
    assert.equal(stripPayloads('Failed query: select 1 params: a,b,c'), 'Failed query: select 1');
  });

  it('elides a long opaque run wherever it appears', () => {
    assert.equal(stripPayloads(`data=${'A'.repeat(300)} end`), 'data=… end');
  });

  it('leaves ordinary text, including real SQL, intact', () => {
    assert.equal(stripPayloads('column "asset_id" does not exist'), 'column "asset_id" does not exist');
  });
});
