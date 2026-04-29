export type ImageContent = {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
};

export type TextContent = { type: 'text'; text: string };

export type MessageContent = string | (TextContent | ImageContent)[];

export type ChatMessage = { role: 'system' | 'user'; content: MessageContent };

export function isServerAiConfigured(): boolean {
  const key = process.env.HANDOFF_AI_API_KEY?.trim();
  return Boolean(key && key.length > 0);
}

export function getServerAiModel(): string {
  return process.env.HANDOFF_AI_MODEL?.trim() || 'gpt-4.1';
}

/** Build an image_url content part from a base64 PNG/JPEG buffer. */
export function imageFromBase64(base64: string, mime: 'image/png' | 'image/jpeg' = 'image/png'): ImageContent {
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
}

/** Build a user message that includes both text and one or more images. */
export function visionMessage(text: string, images: ImageContent[]): ChatMessage {
  return { role: 'user', content: [{ type: 'text', text }, ...images] };
}

/**
 * OpenAI chat completions (JSON mode). Supports both text-only and
 * vision/multimodal messages via the content array format.
 */
export async function openAiChatJson(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.HANDOFF_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('HANDOFF_AI_API_KEY is not configured.');
  }
  const model = getServerAiModel();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error('Invalid HANDOFF_AI_API_KEY.');
    }
    if (response.status === 429) {
      throw new Error('OpenAI rate limit; try again shortly.');
    }
    throw new Error(`OpenAI error (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI.');
  }
  return content;
}
