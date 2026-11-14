import { describe, expect, it } from 'vitest';
import {
  buildOutputItems,
  renderResponseObject,
  responsesStreamFrames,
  type ResponsesStreamResult,
} from '@/src/core/gateway/render-responses';
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
  meta: { model: string; previousResponseId: string | null; store: boolean; responseId?: string; createdAt?: number },
): Promise<{ events: SseEvent[]; completed: ResponsesStreamResult | null }> {
  const frames: string[] = [];
  let completed: ResponsesStreamResult | null = null;
  for await (const frame of responsesStreamFrames(streamOf(chunks), meta, (result) => {
    completed = result;
  })) {
    frames.push(frame);
  }
  const parser = new SseParser();
  return { events: parser.push(frames.join('')), completed };
}

const RESULT: UpstreamResult = {
  text: 'ответ',
  reasoning: '',
  toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{"a":1}' } }],
  finishReason: 'tool_calls',
  usage: { inputTokens: 9, outputTokens: 4 },
  id: 'chatcmpl-1',
  model: 'gpt-6-luna',
  created: 1_700_000_000,
};

describe('render-responses: response object', () => {
  it('carries previous_response_id, store and usage totals', () => {
    const response = renderResponseObject(RESULT, {
      model: 'gpt-6-luna',
      previousResponseId: 'resp_prev',
      store: false,
      id: 'resp_fixed',
      createdAt: 1_700_000_123,
    });
    expect(response).toMatchObject({
      id: 'resp_fixed',
      object: 'response',
      created_at: 1_700_000_123,
      status: 'completed',
      model: 'gpt-6-luna',
      output_text: 'ответ',
      previous_response_id: 'resp_prev',
      store: false,
      error: null,
      usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
    });
  });

  it('renders function_call items after the text message', () => {
    const items = buildOutputItems(RESULT);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ответ', annotations: [] }],
    });
    expect(items[1]).toEqual({
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'calc',
      arguments: '{"a":1}',
      status: 'completed',
    });

    const toolOnly = renderResponseObject(
      { ...RESULT, text: '', usage: { inputTokens: 1, outputTokens: 1 } },
      { model: 'gpt-6-luna', previousResponseId: null, store: true },
    );
    expect(toolOnly.output).toHaveLength(1);
    expect(toolOnly.output[0]?.type).toBe('function_call');
    expect(toolOnly.output_text).toBe('');
    expect(toolOnly.previous_response_id).toBeNull();
  });
});

describe('render-responses: SSE sequence', () => {
  it('emits created → in_progress → deltas → completed with usage', async () => {
    const { events, completed } = await collect(
      [
        chunk({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { role: 'assistant', content: 'от' }, finish_reason: null }] }),
        chunk({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'вет' }, finish_reason: null }] }),
        chunk({
          id: 'chatcmpl-1',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        }),
        'data: [DONE]\n\n',
      ],
      { model: 'gpt-6-luna', previousResponseId: 'resp_prev', store: true, responseId: 'resp_fixed', createdAt: 1_700_000_123 },
    );

    expect(events.map((event) => event.event)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((event) => JSON.parse(event.data).sequence_number)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);

    const created = JSON.parse(events[0]!.data) as {
      response: { id: string; status: string; previous_response_id: string | null; store: boolean };
    };
    expect(created.response).toMatchObject({
      id: 'resp_fixed',
      status: 'in_progress',
      previous_response_id: 'resp_prev',
      store: true,
    });

    const completedEvent = JSON.parse(events[9]!.data) as {
      response: {
        status: string;
        output_text: string;
        usage: { input_tokens: number; output_tokens: number; total_tokens: number };
      };
    };
    expect(completedEvent.response.status).toBe('completed');
    expect(completedEvent.response.output_text).toBe('ответ');
    expect(completedEvent.response.usage).toEqual({ input_tokens: 9, output_tokens: 4, total_tokens: 13 });

    expect(completed).not.toBeNull();
    expect(completed!.text).toBe('ответ');
    expect(completed!.response.store).toBe(true);
    expect(completed!.response.previous_response_id).toBe('resp_prev');
  });

  it('streams function_call deltas and marks store:false', async () => {
    const { events, completed } = await collect(
      [
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'call_5', function: { name: 'calc', arguments: '{"a"' } }] },
              finish_reason: null,
            },
          ],
        }),
        chunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':2}' } }] } }] }),
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
      ],
      { model: 'gpt-6-luna', previousResponseId: null, store: false, responseId: 'resp_tool' },
    );

    const names = events.map((event) => event.event);
    expect(names[2]).toBe('response.output_item.added');
    expect(names).toContain('response.function_call_arguments.delta');
    expect(names).toContain('response.function_call_arguments.done');

    const done = JSON.parse(events.at(-1)!.data) as {
      response: { store: boolean; output: Array<{ type: string; name: string; arguments: string; call_id: string }> };
    };
    expect(done.response.store).toBe(false);
    expect(done.response.output).toEqual([
      {
        type: 'function_call',
        id: 'fc_5',
        call_id: 'call_5',
        name: 'calc',
        arguments: '{"a":2}',
        status: 'completed',
      },
    ]);
    expect(completed!.response.store).toBe(false);
  });
});