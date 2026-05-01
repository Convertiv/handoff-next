import { logAiEvent } from './event-log';

export type ImageContent = {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
};

export type TextContent = { type: 'text'; text: string };

export type MessageContent = string | (TextContent | ImageContent)[];

export type ChatMessage = { role: 'system' | 'user'; content: MessageContent };
export type ImageEditSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
export type ImageEditInput = {
  filename: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
};

/** When true, AI routes forward to HANDOFF_CLOUD_URL with HANDOFF_CLOUD_TOKEN (no local OpenAI key). */
export function shouldProxyAi(): boolean {
  if (process.env.HANDOFF_AI_API_KEY?.trim()) return false;
  return Boolean(process.env.HANDOFF_CLOUD_URL?.trim() && process.env.HANDOFF_CLOUD_TOKEN?.trim());
}

export function isServerAiConfigured(): boolean {
  const key = process.env.HANDOFF_AI_API_KEY?.trim();
  console.log('env', process.env);
  return Boolean(key && key.length > 0) || shouldProxyAi();
}

export function getServerAiModel(): string {
  return process.env.HANDOFF_AI_MODEL?.trim() || 'gpt-4.1';
}

/** Upper bound for OpenAI chat fetch (connect + response); avoids hung generation when API stalls. */
function openAiChatRequestTimeoutMs(): number {
  const n = Number(process.env.HANDOFF_AI_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 30_000) return Math.min(n, 600_000);
  return 180_000;
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
 * OpenAI image edits. Uses HANDOFF_AI_API_KEY.
 */
export async function openAiImageEdit({
  prompt,
  images,
  model = 'gpt-image-2',
  size = '1024x1024',
  actorUserId,
  route,
  eventType = 'ai.image_edit',
}: {
  prompt: string;
  images: ImageEditInput[];
  model?: string;
  size?: ImageEditSize;
  actorUserId?: string | null;
  route?: string | null;
  eventType?: string;
}): Promise<string> {
  const startedAt = Date.now();
  const apiKey = process.env.HANDOFF_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('HANDOFF_AI_API_KEY is not configured.');
  }
  if (!prompt.trim()) {
    throw new Error('Image edit prompt is required.');
  }
  if (images.length === 0) {
    throw new Error('At least one image is required.');
  }

  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('size', size);
  for (const image of images) {
    const blob = new Blob([new Uint8Array(image.data)], { type: image.contentType });
    formData.append('image[]', blob, image.filename);
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    await logAiEvent({
      eventType,
      actorUserId,
      route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: `OpenAI image API error (${response.status}): ${body.slice(0, 500)}`,
      requestPrompt: prompt,
      imageCount: images.length,
      metadata: { size, statusCode: response.status },
    });
    if (response.status === 401) {
      throw new Error('Invalid HANDOFF_AI_API_KEY.');
    }
    if (response.status === 429) {
      throw new Error('OpenAI rate limit; try again shortly.');
    }
    throw new Error(`OpenAI image API error (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
  const image = json.data?.[0];
  if (!image?.b64_json && !image?.url) {
    await logAiEvent({
      eventType,
      actorUserId,
      route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: 'OpenAI did not return an image.',
      requestPrompt: prompt,
      imageCount: images.length,
      metadata: { size },
    });
  } else {
    await logAiEvent({
      eventType,
      actorUserId,
      route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'success',
      requestPrompt: prompt,
      imageCount: images.length,
      metadata: { size },
    });
  }
  if (image?.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (image?.url) {
    return image.url;
  }
  throw new Error('OpenAI did not return an image.');
}

/**
 * OpenAI chat completions (JSON mode). Supports both text-only and
 * vision/multimodal messages via the content array format.
 */
export async function openAiChatJson(
  messages: ChatMessage[],
  options?: {
    actorUserId?: string | null;
    route?: string | null;
    eventType?: string;
    model?: string;
    /** Default 8192; raise for large JSON payloads (e.g. generated components). */
    maxTokens?: number;
  }
): Promise<string> {
  const startedAt = Date.now();
  const apiKey = process.env.HANDOFF_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('HANDOFF_AI_API_KEY is not configured.');
  }
  const model = options?.model?.trim() || getServerAiModel();
  const requestPreview = messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      typeof m.content === 'string' ? m.content : m.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join(' ')
    )
    .join('\n\n')
    .slice(0, 1000);

  const timeoutMs = openAiChatRequestTimeoutMs();
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
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
        max_tokens: options?.maxTokens ?? 8192,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error(`OpenAI chat request timed out after ${timeoutMs}ms (raise HANDOFF_AI_REQUEST_TIMEOUT_MS for slow vision calls).`);
    }
    throw e;
  }

  if (!response.ok) {
    const body = await response.text();
    await logAiEvent({
      eventType: options?.eventType ?? 'ai.chat',
      actorUserId: options?.actorUserId,
      route: options?.route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: `OpenAI error (${response.status}): ${body.slice(0, 500)}`,
      requestPrompt: requestPreview,
      metadata: { statusCode: response.status },
    });
    if (response.status === 401) {
      throw new Error('Invalid HANDOFF_AI_API_KEY.');
    }
    if (response.status === 429) {
      throw new Error('OpenAI rate limit; try again shortly.');
    }
    throw new Error(`OpenAI error (${response.status}): ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    await logAiEvent({
      eventType: options?.eventType ?? 'ai.chat',
      actorUserId: options?.actorUserId,
      route: options?.route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: 'Empty response from OpenAI.',
      requestPrompt: requestPreview,
      usageInputTokens: json.usage?.prompt_tokens,
      usageOutputTokens: json.usage?.completion_tokens,
    });
    throw new Error('Empty response from OpenAI.');
  }
  await logAiEvent({
    eventType: options?.eventType ?? 'ai.chat',
    actorUserId: options?.actorUserId,
    route: options?.route,
    model,
    durationMs: Date.now() - startedAt,
    status: 'success',
    requestPrompt: requestPreview,
    responsePreview: content.slice(0, 1000),
    usageInputTokens: json.usage?.prompt_tokens,
    usageOutputTokens: json.usage?.completion_tokens,
  });
  return content;
}
