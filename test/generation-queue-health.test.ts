import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  describeGenerationQueueHealth,
  STALL_AFTER_MS,
  type QueueActivity,
} from '../src/app/lib/server/generation-queue-health';

/**
 * The SS&C demo failure, pinned.
 *
 * `CRON_SECRET` was unset on the deployment, so the only consumer of pending generation jobs 503'd
 * every tick and both generators spun for 15 minutes without saying anything. These tests exist to
 * keep the two verdicts apart: **nothing is draining** (say so immediately) versus **the queue is
 * busy** (keep waiting) — because a single job cannot tell those apart from its own age alone.
 */

const ORIGINAL_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

/** An activity reader that fails the test if the decision needed it. */
const neverRead = (): Promise<QueueActivity> => {
  assert.fail('activity should not be read on this path');
};

const activity = (a: Partial<QueueActivity>): (() => Promise<QueueActivity>) => async () => ({
  runningCount: 0,
  lastTerminalAt: null,
  ...a,
});

const agoMs = (ms: number) => new Date(Date.now() - ms);

describe('describeGenerationQueueHealth', () => {
  it('calls a fresh pending job stalled when the drain cannot run at all', async () => {
    delete process.env.CRON_SECRET;
    // No age threshold on this path: without the secret the drain provably never processes the row,
    // so waiting three minutes to say so would be three minutes of lying.
    const health = await describeGenerationQueueHealth({ status: 'pending', createdAt: new Date() }, neverRead);
    assert.equal(health.drainConfigured, false);
    assert.equal(health.stalled, true);
    assert.match(health.reason ?? '', /CRON_SECRET/);
  });

  it('leaves a young pending job alone — a tick may simply not have fired yet', async () => {
    process.env.CRON_SECRET = 'set';
    const health = await describeGenerationQueueHealth({ status: 'pending', createdAt: agoMs(10_000) }, neverRead);
    assert.equal(health.stalled, false);
  });

  it('does not blame the queue for an old pending job while another job is running', async () => {
    process.env.CRON_SECRET = 'set';
    // The backlog case. The drain takes ≤3 jobs a tick and one image runs minutes, so waiting behind
    // work in progress is normal and must not be reported as a fault.
    const health = await describeGenerationQueueHealth(
      { status: 'pending', createdAt: agoMs(STALL_AFTER_MS + 60_000) },
      activity({ runningCount: 1 })
    );
    assert.equal(health.stalled, false);
  });

  it('accepts a recent terminal transition as proof the drain is alive', async () => {
    process.env.CRON_SECRET = 'set';
    const health = await describeGenerationQueueHealth(
      { status: 'pending', createdAt: agoMs(STALL_AFTER_MS + 60_000) },
      activity({ lastTerminalAt: agoMs(30_000) })
    );
    assert.equal(health.stalled, false);
  });

  it('reports a stall when a job is old and nothing else is moving', async () => {
    process.env.CRON_SECRET = 'set';
    // Covers the cases the secret check cannot see: a preview deployment (crons never register), a
    // plan without minute-level crons, or a deploy that never happened after the schedule was added.
    const health = await describeGenerationQueueHealth(
      { status: 'pending', createdAt: agoMs(STALL_AFTER_MS + 60_000) },
      activity({ runningCount: 0, lastTerminalAt: agoMs(STALL_AFTER_MS * 4) })
    );
    assert.equal(health.drainConfigured, true);
    assert.equal(health.stalled, true);
    assert.match(health.reason ?? '', /drained/);
  });

  it('never calls a running job stalled, even with no secret — the inline path also advances jobs', async () => {
    delete process.env.CRON_SECRET;
    const health = await describeGenerationQueueHealth({ status: 'running', createdAt: agoMs(STALL_AFTER_MS * 5) }, neverRead);
    assert.equal(health.stalled, false);
  });

  it('has nothing to say about jobs that already finished', async () => {
    delete process.env.CRON_SECRET;
    for (const status of ['done', 'failed']) {
      const health = await describeGenerationQueueHealth({ status, createdAt: agoMs(STALL_AFTER_MS * 5) }, neverRead);
      assert.equal(health.stalled, false, `${status} should not be reported as stalled`);
    }
  });

  it('treats a missing createdAt as young rather than stalled', async () => {
    process.env.CRON_SECRET = 'set';
    // A null timestamp is a defaulted column, not evidence of a fault. Guessing "stalled" here would
    // invent a deployment problem out of a schema default.
    const health = await describeGenerationQueueHealth({ status: 'pending', createdAt: null }, neverRead);
    assert.equal(health.stalled, false);
  });
});
