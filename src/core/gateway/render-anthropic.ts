import { messageId } from '@/src/lib/ids';
import { parseStreamChunk } from './parse';
import { sseFrame } from './sse';
import type { UpstreamResult } from './types';

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type AnthropicMessageObject = {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

export function mapStopReason(
  finishReason: string | null,
  text: string,
  stopSequences: string[] = [],
): { stop_reason: string; stop_sequence: string | null } {
  if (finishReason === 'length') return { stop_reason: 'max_tokens', stop_sequence: null };
  if (finishReason === 'tool_calls') return { stop_reason: 'tool_use', stop_sequence: null };
  if (finishReason === 'content_filter') return { stop_reason: 'refusal', stop_sequence: null };
  const matched = stopSequences.find((sequence) => sequence.length > 0 && text.endsWith(sequence));
  if (matched) return { stop_reason: 'stop_sequence', stop_sequence: matched };
  return { stop_reason: 'end_turn', stop_sequence: null };
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function renderAnthropicMessage(
  result: UpstreamResult,
  options: { model: string; stopSequences?: string[]; id?: string },
): AnthropicMessageObject {
  const content: AnthropicContentBlock[] = [];
  if (result.text.length > 0 || result.toolCalls.length === 0) content.push({ type: 'text', text: result.text });
  for (const call of result.toolCalls) {
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) });
  }
  const stop = mapStopReason(result.finishReason, result.text, options.stopSequences);
  return {
    id: options.id ?? messageId(),
    type: 'message',
    role: 'assistant',
    model: options.model,
    content,
    stop_reason: stop.stop_reason,
    stop_sequence: stop.stop_sequence,
    usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
  };
}

export type AnthropicStreamMeta = {
  model: string;
  inputTokensEstimate: number;
  stopSequences?: string[];
  messageId?: string;
};

export type AnthropicStreamResult = {
  message: AnthropicMessageObject;
  usage: { inputTokens: number; outputTokens: number };
};

const PING_INTERVAL_MS = 15_000;

type ReadResult = { kind: 'chunk'; value: Uint8Array } | { kind: 'done' } | { kind: 'ping' };

async function readWithPing(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ping = new Promise<ReadResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'ping' }), PING_INTERVAL_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      reader.read().then(({ done, value }): ReadResult => (done || !value ? { kind: 'done' } : { kind: 'chunk', value })),
      ping,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Anthropic Messages SSE sequence: message_start, content_block_start, ping,
 * deltas, content_block_stop, message_delta, message_stop. `[DONE]` is never sent.
 */
export async function* anthropicStreamFrames(
  upstream: ReadableStream<Uint8Array>,
  meta: AnthropicStreamMeta,
  onComplete: (result: AnthropicStreamResult) => void,
): AsyncGenerator<string> {
  const id = meta.messageId ?? messageId();
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sequenceIndex = 0;
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let text = '';
  let usage = { inputTokens: meta.inputTokensEstimate, outputTokens: 0 };
  let finishReason: string | null = null;
  const toolBlocks = new Map<number, { index: number; id: string; name: string; arguments: string }>();

  const frame = (event: string, data: unknown) => sseFrame(event, data);

  try {
    yield frame('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        content: [],
        model: meta.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.inputTokens, output_tokens: 0 },
      },
    });

    let openBlock = false;
    const handleEvent = function* (dataText: string): Generator<string> {
      if (dataText === '[DONE]') return;
      let payload: unknown;
      try {
        payload = JSON.parse(dataText);
      } catch {
        return;
      }
      const delta = parseStreamChunk(payload);
      if (delta.usage) {
        usage = {
          inputTokens: delta.usage.inputTokens || usage.inputTokens,
          outputTokens: delta.usage.outputTokens,
        };
      }
      if (delta.finishReason) finishReason = delta.finishReason;

      for (const call of delta.toolCalls) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          if (textBlockOpen) {
            yield frame('content_block_stop', { type: 'content_block_stop', index: textBlockIndex });
            textBlockOpen = false;
            openBlock = false;
          }
          const blockIndex = nextBlockIndex();
          block = {
            index: blockIndex,
            id: call.id ?? `toolu_${call.index}`,
            name: call.name ?? '',
            arguments: '',
          };
          toolBlocks.set(call.index, block);
          openBlock = true;
          yield frame('content_block_start', {
            type: 'content_block_start',
            index: block.index,
            content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
          });
        } else {
          // The first chunk of a tool call already carries the full name; later chunks may extend it.
          if (call.id) block.id = call.id;
          if (call.name) block.name += call.name;
        }
        if (call.arguments) {
          block.arguments += call.arguments;
          yield frame('content_block_delta', {
            type: 'content_block_delta',
            index: block.index,
            delta: { type: 'input_json_delta', partial_json: call.arguments },
          });
        }
      }

      if (delta.content.length > 0) {
        if (!textBlockOpen) {
          textBlockIndex = nextBlockIndex();
          textBlockOpen = true;
          openBlock = true;
          yield frame('content_block_start', {
            type: 'content_block_start',
            index: textBlockIndex,
            content_block: { type: 'text', text: '' },
          });
        }
        text += delta.content;
        yield frame('content_block_delta', {
          type: 'content_block_delta',
          index: textBlockIndex,
          delta: { type: 'text_delta', text: delta.content },
        });
      }
      void openBlock;
    };

    let blockCounter = 0;
    const nextBlockIndex = () => blockCounter++;

    yield frame('ping', { type: 'ping' });

    for (;;) {
      const result = await readWithPing(reader);
      if (result.kind === 'ping') {
        yield frame('ping', { type: 'ping' });
        continue;
      }
      if (result.kind === 'done') break;
      buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataText = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (dataText) yield* handleEvent(dataText);
        separator = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) {
      const dataText = buffer
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (dataText) yield* handleEvent(dataText);
    }

    if (textBlockOpen) {
      yield frame('content_block_stop', { type: 'content_block_stop', index: textBlockIndex });
      textBlockOpen = false;
    }
    for (const block of [...toolBlocks.values()].sort((a, b) => a.index - b.index)) {
      yield frame('content_block_stop', { type: 'content_block_stop', index: block.index });
    }

    const stop = mapStopReason(finishReason, text, meta.stopSequences ?? []);
    yield frame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stop.stop_reason, stop_sequence: stop.stop_sequence },
      usage: { output_tokens: usage.outputTokens },
    });
    yield frame('message_stop', { type: 'message_stop' });

    const content: AnthropicContentBlock[] = [];
    if (text.length > 0 || toolBlocks.size === 0) content.push({ type: 'text', text });
    for (const block of [...toolBlocks.values()].sort((a, b) => a.index - b.index)) {
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: parseArguments(block.arguments) });
    }
    onComplete({
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: meta.model,
        content,
        stop_reason: stop.stop_reason,
        stop_sequence: stop.stop_sequence,
        usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
      },
      usage,
    });
  } finally {
    reader.releaseLock();
  }
  void sequenceIndex;
}