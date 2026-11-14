import { describe, expect, it } from 'vitest';
import { GatewayError } from '@/src/core/gateway/errors';
import {
  countInputTokens,
  normalizeAnthropic,
  normalizeChat,
  normalizeResponses,
} from '@/src/core/gateway/normalize';

function gatewayError(fn: () => unknown): GatewayError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GatewayError) return error;
    throw error;
  }
  throw new Error('expected GatewayError');
}

describe('normalize: OpenAI chat fixtures', () => {
  it('1. plain text request keeps defaults', () => {
    const request = normalizeChat({
      model: 'glm-5.3-flash',
      messages: [{ role: 'user', content: 'привет' }],
    });
    expect(request).toMatchObject({
      model: 'glm-5.3-flash',
      stream: false,
      protocol: 'chat',
      messages: [{ role: 'user', content: 'привет' }],
    });
    expect(request.maxTokens).toBeUndefined();
    expect(request.temperature).toBeUndefined();
  });

  it('2. image parts are normalized to image_url objects', () => {
    const request = normalizeChat({
      model: 'glm-5.3-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'что на фото?' },
            { type: 'image_url', image_url: { url: 'https://example.test/a.png', detail: 'high' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: 'data:image/png;base64,AAAA' }],
        },
      ],
    });
    expect(request.messages[0]?.content).toEqual([
      { type: 'text', text: 'что на фото?' },
      { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
    ]);
    expect(request.messages[1]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('3. developer role becomes system; tool_calls and tool messages survive', () => {
    const request = normalizeChat({
      model: 'glm-5.3-flash',
      messages: [
        { role: 'developer', content: 'будь краток' },
        { role: 'user', content: 'погода?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Москва"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"temp":3}' },
      ],
      tools: [{ type: 'function', function: { name: 'weather' } }],
      tool_choice: 'auto',
    });
    expect(request.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(request.messages[2]?.tool_calls?.[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'weather', arguments: '{"city":"Москва"}' },
    });
    expect(request.messages[3]?.tool_call_id).toBe('call_1');
    expect(request.tools?.[0]?.function.parameters).toEqual({ type: 'object', properties: {} });
    expect(request.toolChoice).toBe('auto');
  });

  it('4. stop string becomes an array and max_completion_tokens wins', () => {
    const single = normalizeChat({
      model: 'glm-5.3-flash',
      messages: [{ role: 'user', content: 'x' }],
      stop: '\n\n',
      max_tokens: 100,
      max_completion_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
    });
    expect(single.stop).toEqual(['\n\n']);
    expect(single.maxTokens).toBe(256);

    const list = normalizeChat({
      model: 'glm-5.3-flash',
      messages: [{ role: 'user', content: 'x' }],
      stop: ['a', 'b'],
    });
    expect(list.stop).toEqual(['a', 'b']);
  });

  it('5. unsupported parameters are rejected with unsupported_parameter', () => {
    const n = gatewayError(() =>
      normalizeChat({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'x' }], n: 2 }),
    );
    expect(n.code).toBe('unsupported_parameter');
    expect(n.status).toBe(400);

    const logprobs = gatewayError(() =>
      normalizeChat({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'x' }], logprobs: true }),
    );
    expect(logprobs.code).toBe('unsupported_parameter');
  });

  it('6. empty assistant message without tool_calls is invalid; bad body is invalid', () => {
    const empty = gatewayError(() =>
      normalizeChat({
        model: 'glm-5.3-flash',
        messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '' }],
      }),
    );
    expect(empty.code).toBe('invalid_request');
    expect(empty.status).toBe(400);

    const noModel = gatewayError(() => normalizeChat({ messages: [{ role: 'user', content: 'x' }] }));
    expect(noModel.code).toBe('invalid_request');
    expect(noModel.message).toContain('model');
  });
});

describe('normalize: Responses fixtures', () => {
  it('7. string input + instructions + store:false + previous_response_id', () => {
    const normalized = normalizeResponses({
      model: 'gpt-6-luna',
      instructions: 'ты помощник',
      input: 'привет',
      stream: true,
      store: false,
      previous_response_id: 'resp_abc',
    });
    expect(normalized.request).toMatchObject({
      model: 'gpt-6-luna',
      stream: true,
      protocol: 'responses',
      messages: [
        { role: 'system', content: 'ты помощник' },
        { role: 'user', content: 'привет' },
      ],
    });
    expect(normalized.store).toBe(false);
    expect(normalized.previousResponseId).toBe('resp_abc');
  });

  it('8. function_call / function_call_output / input_image items', () => {
    const normalized = normalizeResponses({
      model: 'gpt-6-luna',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'найди' }] },
        {
          type: 'function_call',
          call_id: 'call_9',
          name: 'search',
          arguments: '{"q":"x"}',
        },
        { type: 'function_call_output', call_id: 'call_9', output: { hits: 1 } },
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: 'https://example.test/b.png' }],
        },
      ],
    });
    const messages = normalized.request.messages;
    expect(messages[0]).toEqual({ role: 'user', content: 'найди' });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
    });
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_9', content: '{"hits":1}' });
    expect(messages[3]).toEqual({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.test/b.png' } }],
    });
    expect(normalized.store).toBe(true);
    expect(normalized.previousResponseId).toBeNull();
  });

  it('9. text.format and function tools/tool_choice are forwarded', () => {
    const normalized = normalizeResponses({
      model: 'gpt-6-luna',
      input: 'json please',
      text: { format: { type: 'json_schema', name: 'answer' } },
      tools: [{ type: 'function', name: 'lookup', description: 'find', parameters: { type: 'object' } }],
      tool_choice: { type: 'function', name: 'lookup' },
    });
    expect(normalized.request.responseFormat).toEqual({ type: 'json_schema', name: 'answer' });
    expect(normalized.request.tools?.[0]).toEqual({
      type: 'function',
      function: { name: 'lookup', description: 'find', parameters: { type: 'object' } },
    });
    expect(normalized.request.toolChoice).toEqual({ type: 'function', function: { name: 'lookup' } });
  });
});

describe('normalize: Anthropic Messages fixtures', () => {
  it('10. system blocks join with a blank line; tool_use/tool_result map to chat shapes', () => {
    const normalized = normalizeAnthropic({
      model: 'claude-sonnet-5-5',
      max_tokens: 512,
      system: [{ type: 'text', text: 'строка 1' }, { type: 'text', text: 'строка 2' }],
      messages: [
        { role: 'user', content: 'сколько будет 2+2?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'вызову калькулятор' },
            { type: 'tool_use', id: 'toolu_1', name: 'calc', input: { expr: '2+2' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '4' }] },
            { type: 'text', text: 'спасибо' },
          ],
        },
      ],
      stop_sequences: ['END'],
      stream: true,
    });

    expect(normalized.request.messages[0]).toEqual({ role: 'system', content: 'строка 1\n\nстрока 2' });
    expect(normalized.request.messages[1]).toEqual({ role: 'user', content: 'сколько будет 2+2?' });
    expect(normalized.request.messages[2]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'вызову калькулятор' }],
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'calc', arguments: '{"expr":"2+2"}' } }],
    });
    expect(normalized.request.messages[3]).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: '4' });
    expect(normalized.request.messages[4]).toEqual({ role: 'user', content: 'спасибо' });
    expect(normalized.request.stop).toEqual(['END']);
    expect(normalized.request.stream).toBe(true);
    expect(normalized.request.maxTokens).toBe(512);
    expect(normalized.thinking).toBe(false);
  });

  it('11. image sources become data: or plain URLs', () => {
    const normalized = normalizeAnthropic({
      model: 'claude-sonnet-5-5',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
            { type: 'image', source: { type: 'url', url: 'https://example.test/c.png' } },
            { type: 'text', text: 'сравни' },
          ],
        },
      ],
    });
    expect(normalized.request.messages[0]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      { type: 'image_url', image_url: { url: 'https://example.test/c.png' } },
      { type: 'text', text: 'сравни' },
    ]);
  });

  it('12. tool_choice mapping, thinking flag and token estimate', () => {
    const objectAny = normalizeAnthropic({
      model: 'claude-sonnet-5-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'calc', input_schema: { type: 'object' } }],
      tool_choice: { type: 'any' },
    });
    expect(objectAny.request.toolChoice).toBe('required');
    const anyChoice = normalizeAnthropic({
      model: 'claude-sonnet-5-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'calc', input_schema: { type: 'object' } }],
      tool_choice: 'any',
      thinking: { type: 'enabled', budget_tokens: 1024 },
    });
    expect(anyChoice.request.toolChoice).toBe('required');
    expect(anyChoice.thinking).toBe(true);
    expect(anyChoice.request.messages).toEqual([{ role: 'user', content: 'x' }]);

    const explicit = normalizeAnthropic({
      model: 'claude-sonnet-5-5',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'calc' }],
      tool_choice: { type: 'tool', name: 'calc' },
    });
    expect(explicit.request.toolChoice).toEqual({ type: 'function', function: { name: 'calc' } });

    const { tokens, model } = countInputTokens(
      { model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'привет мир' }] },
      'claude-sonnet-5-5',
    );
    expect(model).toBe('claude-sonnet-5-5');
    expect(tokens).toBeGreaterThan(0);
    expect(countInputTokens(null, 'fallback')).toEqual({ tokens: 0, model: 'fallback' });
  });

  it('normalizes Claude Code system-role messages and joins their text blocks', () => {
    const normalized = normalizeAnthropic({
      model: 'glm-5.3-flash',
      max_tokens: 32_000,
      system: [{ type: 'text', text: 'base system' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'environment' }, { type: 'text', text: 'say ok' }] },
        { role: 'system', content: [{ type: 'text', text: 'Claude Code system prompt' }] },
        { role: 'assistant', content: 'prior response' },
      ],
    });

    expect(normalized.request.messages).toEqual([
      { role: 'system', content: 'base system\n\nClaude Code system prompt' },
      { role: 'user', content: [{ type: 'text', text: 'environment' }, { type: 'text', text: 'say ok' }] },
      { role: 'assistant', content: 'prior response' },
    ]);
  });

  it('rejects a missing max_tokens per the Anthropic contract', () => {
    const error = gatewayError(() =>
      normalizeAnthropic({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(error.code).toBe('invalid_request');
    expect(error.message).toContain('max_tokens');
  });
});