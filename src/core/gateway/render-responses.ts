import { messageId, responseId } from '@/src/lib/ids';
import { parseStreamChunk } from './parse';
import { iterateSse, sseFrame } from './sse';
import type { ToolCall, UpstreamResult } from './types';

export type ResponsesOutputItem =
  | {
      type: 'message';
      id: string;
      status: 'completed';
      role: 'assistant';
      content: Array<{ type: 'output_text'; text: string; annotations: [] }>;
    }
  | {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status: 'completed';
    };

export type ResponsesObject = {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'in_progress' | 'failed' | 'cancelled';
  model: string;
  output: ResponsesOutputItem[];
  output_text: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  previous_response_id: string | null;
  store: boolean;
  error: null;
};

export function buildOutputItems(result: Pick<UpstreamResult, 'text' | 'toolCalls'>): ResponsesOutputItem[] {
  const items: ResponsesOutputItem[] = [];
  if (result.text.length > 0 || result.toolCalls.length === 0) {
    items.push({
      type: 'message',
      id: messageId(),
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: result.text, annotations: [] }],
    });
  }
  for (const call of result.toolCalls) {
    items.push({
      type: 'function_call',
      id: `fc_${call.id.replace(/^call_/, '')}`,
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      status: 'completed',
    });
  }
  return items;
}

export function renderResponseObject(
  result: UpstreamResult,
  options: { model: string; previousResponseId: string | null; store: boolean; id?: string; createdAt?: number },
): ResponsesObject {
  const output = buildOutputItems(result);
  return {
    id: options.id ?? responseId(),
    object: 'response',
    created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
    status: 'completed',
    model: options.model,
    output,
    output_text: result.text,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
    previous_response_id: options.previousResponseId,
    store: options.store,
    error: null,
  };
}

export type ResponsesStreamMeta = {
  model: string;
  previousResponseId: string | null;
  store: boolean;
  responseId?: string;
  createdAt?: number;
};

export type ResponsesStreamResult = {
  response: ResponsesObject;
  usage: { inputTokens: number; outputTokens: number };
  text: string;
};

/**
 * Emits the mandatory Responses SSE sequence while consuming upstream chat chunks.
 * The caller persists `result.response` when `store` is true.
 */
export async function* responsesStreamFrames(
  upstream: ReadableStream<Uint8Array>,
  meta: ResponsesStreamMeta,
  onComplete: (result: ResponsesStreamResult) => void,
): AsyncGenerator<string> {
  const id = meta.responseId ?? responseId();
  const createdAt = meta.createdAt ?? Math.floor(Date.now() / 1000);
  let sequence = 0;
  let text = '';
  const toolCalls = new Map<number, ToolCall>();
  const openToolBlocks = new Map<number, string>();
  let textItemId: string | null = null;
  let textClosed = false;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: string | null = null;

  const baseResponse: ResponsesObject = {
    id,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    model: meta.model,
    output: [],
    output_text: '',
    usage: null,
    previous_response_id: meta.previousResponseId,
    store: meta.store,
    error: null,
  };

  const event = (name: string, data: unknown) =>
    sseFrame(name, { type: name, sequence_number: sequence++, ...(data as Record<string, unknown>) });

  yield event('response.created', { response: baseResponse });
  yield event('response.in_progress', { response: baseResponse });

  for await (const sse of iterateSse(upstream)) {
    if (sse.data === '[DONE]') break;
    let payload: unknown;
    try {
      payload = JSON.parse(sse.data);
    } catch {
      continue;
    }
    const delta = parseStreamChunk(payload);
    if (delta.usage) usage = delta.usage;
    if (delta.finishReason) finishReason = delta.finishReason;

    for (const callDelta of delta.toolCalls) {
      const index = callDelta.index;
      let itemId = openToolBlocks.get(index);
      if (!itemId) {
        itemId = messageId();
        openToolBlocks.set(index, itemId);
        toolCalls.set(index, {
          id: callDelta.id ?? `call_${index}`,
          type: 'function',
          function: { name: callDelta.name ?? '', arguments: '' },
        });
        yield event('response.output_item.added', {
          output_index: index,
          item: {
            type: 'function_call',
            id: itemId,
            call_id: callDelta.id ?? `call_${index}`,
            name: callDelta.name ?? '',
            arguments: '',
            status: 'in_progress',
          },
        });
      } else {
        // The first chunk of a tool call already carries the full name; later chunks may extend it.
        const entry = toolCalls.get(index);
        if (entry) {
          if (callDelta.id) entry.id = callDelta.id;
          if (callDelta.name) entry.function.name += callDelta.name;
        }
      }
      const entry = toolCalls.get(index);
      if (!entry) continue;
      if (callDelta.arguments) {
        entry.function.arguments += callDelta.arguments;
        yield event('response.function_call_arguments.delta', {
          item_id: itemId,
          output_index: index,
          delta: callDelta.arguments,
        });
      }
    }

    if (delta.content.length > 0) {
      if (!textItemId) {
        textItemId = messageId();
        yield event('response.output_item.added', {
          output_index: 0,
          item: { type: 'message', id: textItemId, status: 'in_progress', role: 'assistant', content: [] },
        });
        yield event('response.content_part.added', {
          item_id: textItemId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
      }
      text += delta.content;
      yield event('response.output_text.delta', {
        item_id: textItemId,
        output_index: 0,
        content_index: 0,
        delta: delta.content,
      });
    }
  }

  if (textItemId && !textClosed) {
    textClosed = true;
    yield event('response.output_text.done', {
      item_id: textItemId,
      output_index: 0,
      content_index: 0,
      text,
    });
    yield event('response.content_part.done', {
      item_id: textItemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text, annotations: [] },
    });
    yield event('response.output_item.done', {
      output_index: 0,
      item: {
        type: 'message',
        id: textItemId,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    });
  }

  const orderedTools = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
  for (const [index, itemId] of openToolBlocks) {
    const call = toolCalls.get(index);
    if (!call) continue;
    yield event('response.function_call_arguments.done', {
      item_id: itemId,
      output_index: index,
      arguments: call.function.arguments,
    });
    yield event('response.output_item.done', {
      output_index: index,
      item: {
        type: 'function_call',
        id: itemId,
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: 'completed',
      },
    });
  }

  const finalResult: UpstreamResult = {
    text,
    reasoning: '',
    toolCalls: orderedTools,
    finishReason,
    usage,
    id,
    model: meta.model,
    created: createdAt,
  };
  const response = renderResponseObject(finalResult, {
    model: meta.model,
    previousResponseId: meta.previousResponseId,
    store: meta.store,
    id,
    createdAt,
  });
  yield event('response.completed', { response });
  onComplete({ response, usage, text });
}