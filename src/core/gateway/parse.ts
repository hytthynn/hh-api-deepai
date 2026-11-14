import type { ToolCall, UpstreamResult } from './types';

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const block = asJson(part);
        return typeof block.text === 'string' ? block.text : '';
      })
      .join('');
  }
  return '';
}

export function parseToolCalls(value: unknown): ToolCall[] {
  return asArray(value).map((item, index) => {
    const call = asJson(item);
    const fn = asJson(call.function);
    return {
      id: typeof call.id === 'string' && call.id ? call.id : `call_${index}`,
      type: 'function' as const,
      function: {
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      },
    };
  });
}

export function parseUsage(value: unknown): { inputTokens: number; outputTokens: number } {
  const usage = asJson(value);
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  };
}

export function parseChatCompletion(body: unknown, fallbackModel: string): UpstreamResult {
  const data = asJson(body);
  const choice = asJson(asArray(data.choices)[0]);
  const message = asJson(choice.message);
  return {
    text: contentToText(message.content),
    reasoning: contentToText(message.reasoning_content ?? message.reasoning),
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    usage: parseUsage(data.usage),
    id: typeof data.id === 'string' ? data.id : '',
    model: typeof data.model === 'string' ? data.model : fallbackModel,
    created: typeof data.created === 'number' ? data.created : Math.floor(Date.now() / 1000),
  };
}

export type StreamDelta = {
  content: string;
  reasoning: string;
  toolCalls: Array<{ index: number; id?: string; name?: string; arguments?: string }>;
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  id: string | null;
  model: string | null;
};

export function parseStreamChunk(payload: unknown): StreamDelta {
  const data = asJson(payload);
  const choice = asJson(asArray(data.choices)[0]);
  const delta = asJson(choice.delta);
  const toolCalls = asArray(delta.tool_calls).map((item, index) => {
    const call = asJson(item);
    const fn = asJson(call.function);
    return {
      index: typeof call.index === 'number' ? call.index : index,
      id: typeof call.id === 'string' ? call.id : undefined,
      name: typeof fn.name === 'string' ? fn.name : undefined,
      arguments: typeof fn.arguments === 'string' ? fn.arguments : undefined,
    };
  });
  const usage = data.usage ? parseUsage(data.usage) : null;
  return {
    content: contentToText(delta.content),
    reasoning: contentToText(delta.reasoning_content ?? delta.reasoning),
    toolCalls,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    usage,
    id: typeof data.id === 'string' ? data.id : null,
    model: typeof data.model === 'string' ? data.model : null,
  };
}

export const FINISH_MAP_ANTHROPIC: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  content_filter: 'refusal',
};

export const FINISH_MAP_CHAT: Record<string, string> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_calls',
  content_filter: 'content_filter',
};