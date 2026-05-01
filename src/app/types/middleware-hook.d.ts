declare module './middleware-hook.mjs' {
  import type { NextRequest, NextResponse } from 'next/server';

  export const userMiddleware:
    | ((
        request: NextRequest,
        defaultProxy: (request: NextRequest) => Promise<NextResponse>
      ) => Promise<NextResponse>)
    | undefined;
}
