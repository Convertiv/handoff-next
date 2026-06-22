import { logAiEvent } from './event-log';

export type ImageContent = {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
};

export type TextContent = { type: 'text'; text: string };

export type MessageContent = string | (TextContent | ImageContent)[];

export type ChatMessage = { role: 'system' | 'user'; content: MessageContent };
export type ImageEditSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x1152' | 'auto';
export type ImageEditQuality = 'auto' | 'low' | 'medium' | 'high';
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
  quality = 'auto',
  actorUserId,
  route,
  eventType = 'ai.image_edit',
}: {
  prompt: string;
  images: ImageEditInput[];
  model?: string;
  size?: ImageEditSize;
  quality?: ImageEditQuality;
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
  formData.append('quality', quality);
  for (const image of images) {
    const blob = new Blob([new Uint8Array(image.data)], { type: image.contentType });
    formData.append('image[]', blob, image.filename);
  }

  // Hard ceiling below the 300s SSE/function deadline so a stalled OpenAI
  // request surfaces as a real error event instead of the worker hanging
  // until the stream closes (which the client reports as "No image returned.").
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    await logAiEvent({
      eventType,
      actorUserId,
      route,
      model,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: isTimeout ? 'OpenAI image request timed out.' : `OpenAI image request failed: ${err instanceof Error ? err.message : String(err)}`,
      requestPrompt: prompt,
      imageCount: images.length,
      metadata: { size, quality },
    });
    throw new Error(isTimeout ? 'OpenAI image generation timed out; try a lower quality or simpler prompt.' : 'OpenAI image request failed.');
  }

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
      metadata: { size, quality, statusCode: response.status },
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
      metadata: { size, quality },
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
      metadata: { size, quality },
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

export type OpenAiTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

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

/**
 * OpenAI chat completions with streaming and tool support.
 * Returns a ReadableStream that emits newline-delimited JSON events:
 *   {"type":"delta","content":"..."}
 *   {"type":"action","action":{"type":"<function_name>",...args}}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */
export async function openAiChatStream(
  messages: ChatMessage[],
  tools: OpenAiTool[],
  options?: {
    actorUserId?: string | null;
    route?: string | null;
    eventType?: string;
    model?: string;
    maxTokens?: number;
  }
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.HANDOFF_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('HANDOFF_AI_API_KEY is not configured.');
  }
  const model = options?.model?.trim() || getServerAiModel();
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: options?.maxTokens ?? 4096,
  };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const encoder = new TextEncoder();

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : `HTTP ${response.status}`;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: `OpenAI error (${response.status}): ${errText.slice(0, 500)}` }) + '\n'));
        controller.close();
      },
    });
  }

  const upstream = response.body;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // tool call accumulator: index -> { id, name, arguments }
      const toolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
      let usageInputTokens: number | undefined;
      let usageOutputTokens: number | undefined;

      const emit = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line === 'data: [DONE]') {
              if (line === 'data: [DONE]') {
                // Flush accumulated tool calls
                for (const tc of Object.values(toolCalls)) {
                  let parsedArgs: Record<string, unknown> = {};
                  try { parsedArgs = JSON.parse(tc.arguments); } catch { /* leave empty */ }
                  emit({ type: 'action', action: { type: tc.name, ...parsedArgs } });
                }
                emit({ type: 'done' });
              }
              continue;
            }
            if (!line.startsWith('data: ')) continue;

            let chunk: {
              choices?: {
                delta?: {
                  content?: string;
                  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
                };
                finish_reason?: string | null;
              }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            try {
              chunk = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (chunk.usage) {
              usageInputTokens = chunk.usage.prompt_tokens;
              usageOutputTokens = chunk.usage.completion_tokens;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) {
              emit({ type: 'delta', content: delta.content });
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = { id: '', name: '', arguments: '' };
                }
                if (tc.id) toolCalls[tc.index].id = tc.id;
                if (tc.function?.name) toolCalls[tc.index].name += tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
              }
            }

            if (choice.finish_reason === 'tool_calls') {
              for (const tc of Object.values(toolCalls)) {
                let parsedArgs: Record<string, unknown> = {};
                try { parsedArgs = JSON.parse(tc.arguments); } catch { /* leave empty */ }
                emit({ type: 'action', action: { type: tc.name, ...parsedArgs } });
              }
              // Clear after flushing so [DONE] doesn't double-emit
              for (const k of Object.keys(toolCalls)) delete toolCalls[Number(k)];
              emit({ type: 'done' });
            }
          }
        }
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Stream read error' });
      } finally {
        reader.releaseLock();
        controller.close();
      }

      // Log event after stream ends
      try {
        await logAiEvent({
          eventType: options?.eventType ?? 'ai.chat',
          actorUserId: options?.actorUserId,
          route: options?.route,
          model,
          durationMs: Date.now() - startedAt,
          status: 'success',
          usageInputTokens,
          usageOutputTokens,
        });
      } catch {
        // Non-critical: swallow log errors
      }
    },
  });
}
