'use client';

import { useEffect } from 'react';

export default function FoundationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[foundations]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <h2 className="text-lg font-semibold">Something went wrong loading this page.</h2>
      <p className="text-sm text-gray-500">{error.message || 'An unexpected error occurred.'}</p>
      <button
        onClick={reset}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
      >
        Try again
      </button>
    </div>
  );
}
