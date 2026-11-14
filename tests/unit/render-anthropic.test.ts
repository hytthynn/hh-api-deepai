import { describe, expect, it } from 'vitest';
import {
  anthropicStreamFrames,
  mapStopReason,
  renderAnthropicMessage,
  type AnthropicStreamResult,
} from '@/src/core/gateway/render-anthropic';
import { SseParser, type SseEvent } from '@/src/core/gateway/sse';
import type { UpstreamResult } from '@/src/core/gateway/types';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function chunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function collect(
  chunks: string[],
  meta: { model: string; inputTokensEstimate: number; stopSequences?: string[]; messageId?: string },
): Promise<{ events: SseEvent[]; frames: string[]; completed: AnthropicStreamResult | null }> {
  const frames: string[] = [];
  let completed: AnthropicStreamResult | null = null;
  for await (const frame of anthropicStreamFrames(streamOf(chunks), meta, (result) => {
    completed = result;
  })) {
    frames.push(frame);
  }
  const parser = new SseParser();
  const events = parser.push(frames.join(''));
  return { events, frames, completed };
}

const META = { model: 'claude-sonnet-5-5', inputTokensEstimate: 11, messageId: 'msg_fixed' };

describe('render-anthropic: message object', () => {
  it('maps finish reasons to Anthropic stop reasons', () => {
    expect(mapStopReason('length', 'x')).toEqual({ stop_reason: 'max_tokens', stop_sequence: null });
    expect(mapStopReason('tool_calls', 'x')).toEqual({ stop_reason: 'tool_use', stop_sequence: null });
    expect(mapStopReason('content_filter', 'x')).toEqual({ stop_reason: 'refusal', stop_sequence: null });
    expect(mapStopReason('stop', 'текст END', ['END'])).toEqual({ stop_reason: 'stop_sequence', stop_sequence: 'END' });
    expect(mapStopReason(null, 'готово', ['END'])).toEqual({ stop_reason: 'end_turn', stop_sequence: null });
  });

  it('renders text and tool_use blocks with parsed input', () => {
    const result: UpstreamResult = {
      text: 'считаю',
      reasoning: '',
      toolCalls: [
        { id: 'toolu_1', type: 'function', function: { name: 'calc', arguments: '{"expr":"2+2"}' } },
        { id: 'toolu_2', type: 'function', function: { name: 'broken', arguments: 'not json' } },
      ],
      finishReason: 'tool_calls',
      usage: { inputTokens: 11, outputTokens: 5 },
      id: '',
      model: 'claude-sonnet-5-5',
      created: 0,
    };
    const message = renderAnthropicMessage(result, { model: 'claude-sonnet-5-5', id: 'msg_1' });
    expect(message.id).toBe('msg_1');
    expect(message.type).toBe('message');
    expect(message.role).toBe('assistant');
    expect(message.stop_reason).toBe('tool_use');
    expect(message.usage).toEqual({ input_tokens: 11, output_tokens: 5 });
    expect(message.content).toEqual([
      { type: 'text', text: 'считаю' },
      { type: 'tool_use', id: 'toolu_1', name: 'calc', input: { expr: '2+2' } },
      { type: 'tool_use', id: 'toolu_2', name: 'broken', input: {} },
    ]);
  });
});

describe('render-anthropic: SSE sequence', () => {
  it('emits the exact event order for a text answer and never sends [DONE]', async () => {
    const { events, frames, completed } = await collect(
      [
        chunk({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { role: 'assistant', content: 'При' }, finish_reason: null }] }),
        chunk({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'вет' }, finish_reason: null }] }),
        chunk({
          id: 'chatcmpl-1',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 2 },
        }),
        'data: [DONE]\n\n',
      ],
      META,
    );

    expect(events.map((event) => event.event)).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(frames.join('')).not.toContain('[DONE]');

    const start = JSON.parse(events[0]!.data) as Record<string, never> & {
      message: { id: string; model: string; usage: { input_tokens: number } };
    };
    expect(start.message.id).toBe('msg_fixed');
    expect(start.message.model).toBe('claude-sonnet-5-5');
    expect(start.message.usage.input_tokens).toBe(11);

    expect(JSON.parse(events[2]!.data)).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    expect(JSON.parse(events[3]!.data)).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'При' },
    });
    expect(JSON.parse(events[5]!.data)).toEqual({ type: 'content_block_stop', index: 0 });
    expect(JSON.parse(events[6]!.data)).toEqual({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 },
    });
    expect(JSON.parse(events[7]!.data)).toEqual({ type: 'message_stop' });

    expect(completed).not.toBeNull();
    expect(completed!.message.content).toEqual([{ type: 'text', text: 'Привет' }]);
    expect(completed!.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
  });

  it('streams tool arguments as input_json_delta and closes the block', async () => {
    const { events, completed } = await collect(
      [
        chunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{"a"' } },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        chunk({
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: null },
          ],
        }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
        'data: [DONE]\n\n',
      ],
      META,
    );

    expect(events.map((event) => event.event)).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(JSON.parse(events[2]!.data)).toEqual({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'calc', input: {} },
    });
    expect(JSON.parse(events[3]!.data)).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"a"' },
    });
    expect(JSON.parse(events[4]!.data)).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: ':1}' },
    });
    expect(JSON.parse(events[5]!.data)).toEqual({ type: 'content_block_stop', index: 0 });
    expect(JSON.parse(events[6]!.data)).toMatchObject({ delta: { stop_reason: 'tool_use' } });

    expect(completed!.message.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'calc', input: { a: 1 } },
    ]);
    expect(completed!.message.stop_reason).toBe('tool_use');
  });

  it('closes the text block before opening a tool block and honours stop_sequences', async () => {
    const { events } = await collect(
      [
        chunk({ choices: [{ index: 0, delta: { content: 'готово END' }, finish_reason: null }] }),
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'call_7', function: { name: 'stop', arguments: '{}' } }] },
              finish_reason: null,
            },
          ],
        }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ],
      { ...META, stopSequences: ['END'] },
    );

    const opens = events.filter((event) => event.event === 'content_block_start');
    expect(opens).toHaveLength(2);
    expect(JSON.parse(opens[0]!.data)).toMatchObject({ index: 0, content_block: { type: 'text' } });
    expect(JSON.parse(opens[1]!.data)).toMatchObject({ index: 1, content_block: { type: 'tool_use' } });

    const delta = events.find((event) => event.event === 'message_delta');
    expect(JSON.parse(delta!.data)).toMatchObject({
      delta: { stop_reason: 'stop_sequence', stop_sequence: 'END' },
    });

    const stops = events.filter((event) => event.event === 'content_block_stop');
    expect(stops.map((event) => (JSON.parse(event.data) as { index: number }).index)).toEqual([0, 1]);
  });

  it('survives chunk boundaries split inside a JSON frame', async () => {
    const payload = chunk({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] });
    const split = [
      payload.slice(0, 12),
      payload.slice(12, 30),
      payload.slice(30),
      'data: [DONE]\n\n',
    ];
    const { events, completed } = await collect(split, META);
    expect(events.filter((event) => event.event === 'content_block_delta')).toHaveLength(1);
    expect(completed!.message.content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});