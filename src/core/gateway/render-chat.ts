import { chatCompletionId } from '@/src/lib/ids';
import { FINISH_MAP_CHAT } from './parse';
import type { UpstreamResult } from './types';

export function finishReasonChat(reason: string | null): string {
  if (!reason) return 'stop';
  return FINISH_MAP_CHAT[reason] ?? reason;
}

export type ChatCompletionObject = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string | null; tool_calls?: UpstreamResult['toolCalls'] };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export function renderChatCompletion(
  result: UpstreamResult,
  model: string,
  options: { id?: string; created?: number } = {},
): ChatCompletionObject {
  const message: ChatCompletionObject['choices'][number]['message'] = {
    role: 'assistant',
    content: result.text.length > 0 || result.toolCalls.length === 0 ? result.text : null,
  };
  if (result.toolCalls.length > 0) message.tool_calls = result.toolCalls;
  return {
    id: options.id ?? chatCompletionId(),
    object: 'chat.completion',
    created: options.created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReasonChat(result.finishReason),
      },
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
  };
}

export type ChatChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export function chatRoleChunk(id: string, model: string, created: number): ChatChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  };
}

export function chatTextChunk(id: string, model: string, created: number, text: string): ChatChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
}

export function chatFinishChunk(id: string, model: string, created: number, reason: string | null): ChatChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReasonChat(reason) }],
  };
}

const DONE_FRAME = 'data: [DONE]\n\n';

/**
 * Byte-transparent passthrough for OpenAI-compatible clients: the upstream body is
 * forwarded as received, `[DONE]` is appended when the upstream omits it. Returns
 * counters so the caller can persist usage after the stream closes.
 */
export function passThroughChatStream(
  upstream: ReadableStream<Uint8Array>,
  onDone: (state: { sawDone: boolean; tail: string }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let tail = '';
  let sawDone = false;
  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        tail = (tail + text).slice(-4096);
        if (tail.includes('[DONE]')) sawDone = true;
        controller.enqueue(chunk);
      },
      flush(controller) {
        const rest = decoder.decode();
        if (rest) tail += rest;
        if (!sawDone) controller.enqueue(new TextEncoder().encode(DONE_FRAME));
        onDone({ sawDone, tail });
      },
    }),
  );
}