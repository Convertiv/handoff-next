import { NextResponse, type NextRequest } from 'next/server';

const RETIRED_MESSAGE =
  'Server-side component builds are retired. Build locally with `handoff-app build:components` or `handoff-app push --build`, then push artifacts to hosted Handoff.';

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'Gone',
      message: RETIRED_MESSAGE,
      code: 'server_build_retired',
    },
    { status: 410 }
  );
}

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'Gone',
      message: RETIRED_MESSAGE,
      code: 'server_build_retired',
    },
    { status: 410 }
  );
}
