import assert from 'node:assert';
import { describe, it } from 'node:test';
import { notifyInBackground } from '../src/app/lib/notify';
import { sendTemplatedEmail } from '../src/app/lib/email';

/**
 * The two invariants that make notifications safe to add to a write path — roadmap E.6.
 *
 * Neither is about content. They are about the notification staying out of the way: a build a guest spent an hour
 * on must not fail because a mail provider had a bad minute, and a developer with no mail configuration must not
 * hit an error path that production never sees.
 */
describe('notifyInBackground', () => {
  /**
   * Rule 1: a notification must never fail a write.
   *
   * This is the whole reason the helper exists rather than callers writing `void notify().catch()` themselves —
   * one of them would eventually forget, and the failure would surface as a lost submission.
   */
  it('swallows a rejection instead of letting it escape', async () => {
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      assert.doesNotThrow(() =>
        notifyInBackground('probe', () => Promise.reject(new Error('resend is down')))
      );
      // Let the rejection settle: the catch runs on a later microtask than the synchronous call.
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      console.error = originalError;
    }
    // Swallowed, but not silently — an operator still needs to know delivery failed.
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]), /probe failed/);
  });

  it('does not wait for the notification, so a slow provider cannot stall a write', () => {
    let settled = false;
    notifyInBackground('slow', async () => {
      await new Promise((r) => setTimeout(r, 50));
      settled = true;
    });
    // Returns before the work finishes — the point of the helper.
    assert.equal(settled, false);
  });
});

describe('sendTemplatedEmail without configuration', () => {
  /**
   * Rule 2: silence, not a crash. Matches `sendInviteEmail` and `sendPasswordResetEmail`, so local development and
   * preview deploys need no mail setup at all.
   */
  it('resolves rather than throwing when RESEND_API_KEY is unset', async () => {
    const had = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const originalInfo = console.info;
    console.info = () => {};
    try {
      await sendTemplatedEmail({
        kind: 'probe',
        to: 'someone@example.com',
        subject: 'subject',
        title: 'title',
        body: 'body',
      });
    } finally {
      console.info = originalInfo;
      if (had !== undefined) process.env.RESEND_API_KEY = had;
    }
  });
});
