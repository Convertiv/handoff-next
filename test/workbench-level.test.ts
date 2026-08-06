import assert from 'node:assert';
import { describe, it } from 'node:test';
import { briefBelongsToPage, findBuild, levelFor } from '../src/app/lib/workbench-level';

/**
 * The rules that decide which level of a page the workbench shows, and whether the URL is allowed to ask for
 * it (roadmap E.8).
 *
 * These are security checks, not presentation: `?brief=`/`?build=` name records that are fetched by id, so
 * without them the query string is a way to render any record in the deployment inside your own page's shell.
 */
describe('briefBelongsToPage', () => {
  const brief = { source: 'template', sourcePageId: 'page-1' };

  it('accepts a brief snapshotted from this page', () => {
    assert.equal(briefBelongsToPage(brief, 'page-1'), true);
  });

  it("rejects another page's brief — the URL-tampering case", () => {
    assert.equal(briefBelongsToPage(brief, 'page-2'), false);
  });

  /** Otherwise any page could be nested inside another page as though it were an invitation. */
  it('rejects an ordinary page even when the ids line up', () => {
    assert.equal(briefBelongsToPage({ source: 'playground', sourcePageId: 'page-1' }, 'page-1'), false);
  });

  it('rejects a brief that has lost its parent', () => {
    assert.equal(briefBelongsToPage({ source: 'template', sourcePageId: null }, 'page-1'), false);
  });

  it('rejects a missing brief and an empty page id', () => {
    assert.equal(briefBelongsToPage(null, 'page-1'), false);
    assert.equal(briefBelongsToPage(brief, ''), false);
  });
});

describe('findBuild', () => {
  const builds = [{ id: 'b1' }, { id: 'b2' }];

  it('finds a build of this brief', () => {
    assert.deepEqual(findBuild(builds, 'b2'), { id: 'b2' });
  });

  /** A build you cannot see listed is a build you cannot open. */
  it("returns null for a build that is not this brief's", () => {
    assert.equal(findBuild(builds, 'someone-elses'), null);
  });

  it('returns null when nothing is selected', () => {
    assert.equal(findBuild(builds, ''), null);
  });
});

describe('levelFor', () => {
  it('drills to the deepest selection', () => {
    assert.equal(levelFor(false, false), 'page');
    assert.equal(levelFor(true, false), 'brief');
    assert.equal(levelFor(true, true), 'build');
  });

  /**
   * A build with no brief is an inconsistent URL, not a level: the build panel's only way back is "all builds",
   * which needs the brief. Falling back to `page` keeps the shell coherent instead of rendering a dead end.
   */
  it('falls back to page when a build is named without its brief', () => {
    assert.equal(levelFor(false, true), 'page');
  });
});
