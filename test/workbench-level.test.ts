import assert from 'node:assert';
import { describe, it } from 'node:test';
import { findBuild, levelFor, submissionBelongsToTemplate } from '../src/app/lib/workbench-level';

/**
 * The rules that decide which level of a page the workbench shows, and whether the URL is allowed to ask for
 * it (roadmap E.8).
 *
 * These are security checks, not presentation: `?brief=`/`?build=` name records that are fetched by id, so
 * without them the query string is a way to render any record in the deployment inside your own page's shell.
 */
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
  /**
   * ⚠️ **This rule reversed in the reflow (R.4), deliberately.**
   *
   * It used to fall back to `page`: a build with no brief was an inconsistent URL, because the only way to have
   * a build at all was through a brief, and the panel's one way back — "all builds" — needed it.
   *
   * Under the reflow a share link points at the **template**, so a submitted page descends from it directly and
   * `?build=` alone is a legitimate URL. What stops it becoming a way to render any record inside your shell is
   * unchanged in spirit: the *server* decides, now by `submissionBelongsToTemplate` instead of the brief chain.
   * The back control says "Back to template" when there is no brief to return to.
   */
  it('is a build when one is selected, and the page otherwise', () => {
    // R.5 removed the third level with the briefs themselves; what survives is that the *server* decides
    // whether a build id may appear here, by `submissionBelongsToTemplate`.
    assert.equal(levelFor(true), 'build');
    assert.equal(levelFor(false), 'page');
  });
});

describe('submissionBelongsToTemplate', () => {
  const from = (templateId: string) => ({ provenance: { templateId } });

  it('admits a page whose provenance names this template', () => {
    assert.equal(submissionBelongsToTemplate(from('tpl'), 'tpl'), true);
  });

  it('refuses another template’s page, and anything without provenance', () => {
    // Same job `briefBelongsToPage` does for the legacy chain: without it, `?build=` renders any record in the
    // deployment inside your own page's shell.
    assert.equal(submissionBelongsToTemplate(from('other'), 'tpl'), false);
    assert.equal(submissionBelongsToTemplate({ provenance: null }, 'tpl'), false);
    assert.equal(submissionBelongsToTemplate({}, 'tpl'), false);
    assert.equal(submissionBelongsToTemplate(null, 'tpl'), false);
    assert.equal(submissionBelongsToTemplate(undefined, 'tpl'), false);
  });

  it('refuses an empty template id rather than matching an empty claim', () => {
    assert.equal(submissionBelongsToTemplate(from(''), ''), false);
  });

  it('ignores a provenance that is not an object', () => {
    for (const junk of ['tpl', 42, [], true]) {
      assert.equal(submissionBelongsToTemplate({ provenance: junk }, 'tpl'), false, String(junk));
    }
  });
});
