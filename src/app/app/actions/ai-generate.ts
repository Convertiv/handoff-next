'use server';

import { auth } from '../../lib/auth';

/**
 * Stub for AI-powered component generation. Uses the API key from env vars.
 * Extend this to call OpenAI or Anthropic and return structured component data.
 */
export async function generateComponentWithAI(prompt: string, provider: 'openai' | 'anthropic' = 'openai') {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const apiKey =
    provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} in your environment.`);
  }

  return {
    success: true,
    provider,
    message: `AI generation with ${provider} is configured but not yet implemented. Prompt received: "${prompt.slice(0, 100)}..."`,
  };
}
