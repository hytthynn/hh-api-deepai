import { z } from 'zod';
import { GatewayError } from './errors';
import type { ChatMessage, ChatRequest, ChatTool, ContentPart, ToolCall, ToolChoice } from './types';

function invalid(message: string): GatewayError {
  return new GatewayError('invalid_request', 400, message);
}

function parseWith<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') ?? 'body';
    throw invalid(`${path}: ${issue?.message ?? 'invalid value'}`);
  }
  return result.data;
}

const imageUrlPart = z.object({
  type: z.literal('image_url'),
  image_url: z.union([
    z.string(),
    z.object({ url: z.string(), detail: z.string().optional() }).loose(),
  ]),
});

const textPart = z.object({ type: z.literal('text'), text: z.string() });

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool', 'developer']),
  content: z
    .union([z.string(), z.array(z.union([textPart, imageUrlPart])), z.null()])
    .optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
  reasoning_content: z.string().optional(),
});

const toolSchema = z.object({
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

const chatBodySchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    stream: z.boolean().optional(),
    stream_options: z.object({ include_usage: z.boolean().optional() }).loose().optional(),
    max_tokens: z.number().int().positive().max(131_072).optional(),
    max_completion_tokens: z.number().int().positive().max(131_072).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    n: z.number().int().optional(),
    presence_penalty: z.number().optional(),
    frequency_penalty: z.number().optional(),
    seed: z.number().optional(),
    user: z.string().optional(),
    tools: z.array(toolSchema).optional(),
    tool_choice: z.union([z.enum(['auto', 'none', 'required']), z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) })]).optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: z.record(z.string(), z.unknown()).optional(),
    reasoning_effort: z.string().optional(),
    service_tier: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    logprobs: z.boolean().optional(),
  })
  .loose();

function normalizeContent(
  content: string | Array<z.infer<typeof textPart> | z.infer<typeof imageUrlPart>> | null | undefined,
): string | ContentPart[] {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text };
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
    return { type: 'image_url' as const, image_url: { url } };
  });
}

export function normalizeChat(body: unknown): ChatRequest {
  const data = parseWith(chatBodySchema, body);
  if (data.n !== undefined && data.n !== 1) {
    throw new GatewayError('unsupported_parameter', 400, 'n: only n=1 is supported');
  }
  if (data.logprobs === true) {
    throw new GatewayError('unsupported_parameter', 400, 'logprobs: not supported');
  }
  const messages: ChatMessage[] = data.messages.map((message) => {
    const role = message.role === 'developer' ? 'system' : message.role;
    const normalized: ChatMessage = { role, content: normalizeContent(message.content) };
    if (message.tool_call_id) normalized.tool_call_id = message.tool_call_id;
    if (message.tool_calls) {
      normalized.tool_calls = message.tool_calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.function.name, arguments: call.function.arguments },
      }));
    }
    if (message.name) normalized.name = message.name;
    return normalized;
  });
  for (const message of messages) {
    if (message.role === 'assistant' && !message.tool_calls && message.content === '') {
      throw invalid('messages: assistant message requires content or tool_calls');
    }
  }
  return {
    model: data.model,
    messages,
    stream: data.stream === true,
    maxTokens: data.max_completion_tokens ?? data.max_tokens,
    temperature: data.temperature,
    topP: data.top_p,
    stop: data.stop === undefined ? undefined : typeof data.stop === 'string' ? [data.stop] : data.stop,
    tools: data.tools?.map(toChatTool),
    toolChoice: data.tool_choice as ToolChoice | undefined,
    responseFormat: data.response_format,
    parallelToolCalls: data.parallel_tool_calls,
    protocol: 'chat',
  };
}

function toChatTool(tool: z.infer<typeof toolSchema>): ChatTool {
  return {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: 'object', properties: {} },
    },
  };
}

const responsesItemSchema = z
  .object({
    type: z.string().optional(),
    role: z.string().optional(),
    content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.string().optional(),
    output: z.unknown().optional(),
    id: z.string().optional(),
    summary: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

const responsesBodySchema = z
  .object({
    model: z.string().min(1),
    input: z.union([z.string(), z.array(responsesItemSchema)]),
    instructions: z.string().optional(),
    max_output_tokens: z.number().int().positive().max(131_072).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stream: z.boolean().optional(),
    store: z.boolean().optional(),
    previous_response_id: z.string().nullable().optional(),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
    tool_choice: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    parallel_tool_calls: z.boolean().optional(),
    text: z.object({ format: z.record(z.string(), z.unknown()).optional() }).loose().optional(),
    reasoning: z.object({ effort: z.string().optional() }).loose().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    truncation: z.string().optional(),
    max_tool_calls: z.number().optional(),
  })
  .loose();

export type ResponsesNormalized = {
  request: ChatRequest;
  store: boolean;
  previousResponseId: string | null;
};

export function normalizeResponses(body: unknown, prepend: unknown[] = []): ResponsesNormalized {
  const data = parseWith(responsesBodySchema, body);
  const messages: ChatMessage[] = [];
  if (data.instructions) messages.push({ role: 'system', content: data.instructions });
  if (typeof data.input === 'string') {
    messages.push({ role: 'user', content: data.input });
  } else {
    for (const item of [...prepend, ...data.input]) messages.push(...responsesItemToMessages(item));
  }

  const tools: ChatTool[] = (data.tools ?? [])
    .filter((tool) => (tool.type as string | undefined) === 'function' || tool.type === undefined)
    .map((tool) => ({
      type: 'function' as const,
      function: {
        name: String(tool.name ?? ''),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        parameters: (tool.parameters as Record<string, unknown> | undefined) ?? { type: 'object', properties: {} },
      },
    }));

  let toolChoice: ToolChoice | undefined;
  if (typeof data.tool_choice === 'string') {
    toolChoice = data.tool_choice === 'required' ? 'required' : data.tool_choice === 'none' ? 'none' : 'auto';
  } else if (data.tool_choice && typeof data.tool_choice.name === 'string') {
    toolChoice = { type: 'function', function: { name: data.tool_choice.name } };
  }

  const format = data.text?.format;
  return {
    request: {
      model: data.model,
      messages,
      stream: data.stream === true,
      maxTokens: data.max_output_tokens,
      temperature: data.temperature,
      topP: data.top_p,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice,
      responseFormat: format && format.type ? format : undefined,
      parallelToolCalls: data.parallel_tool_calls,
      protocol: 'responses',
    },
    store: data.store !== false,
    previousResponseId: data.previous_response_id ?? null,
  };
}

function responsesItemToMessages(item: unknown): ChatMessage[] {
  const parsed = responsesItemSchema.safeParse(item);
  if (!parsed.success) return [];
  const data = parsed.data;
  if (data.type === 'function_call' && data.call_id && data.name) {
    return [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: data.call_id,
            type: 'function',
            function: { name: data.name, arguments: data.arguments ?? '{}' },
          },
        ],
      },
    ];
  }
  if (data.type === 'function_call_output' && data.call_id) {
    return [{ role: 'tool', tool_call_id: data.call_id, content: stringifyOutput(data.output) }];
  }
  if (data.type === 'reasoning') return [];
  const role = data.role === 'assistant' ? 'assistant' : data.role === 'system' ? 'system' : 'user';
  if (typeof data.content === 'string') return [{ role, content: data.content }];
  const parts: ContentPart[] = [];
  for (const block of data.content ?? []) {
    const type = block.type;
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      parts.push({ type: 'text', text: String(block.text ?? '') });
    } else if (type === 'input_image' || type === 'image_url') {
      const url = typeof block.image_url === 'string' ? block.image_url : String((block.image_url as { url?: string } | undefined)?.url ?? block.url ?? '');
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  if (parts.length === 0) return [];
  if (parts.every((part) => part.type === 'text')) {
    return [{ role, content: parts.map((part) => (part.type === 'text' ? part.text : '')).join('') }];
  }
  return [{ role, content: parts }];
}

function stringifyOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output;
  return JSON.stringify(output);
}

const anthropicBlockSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    source: z
      .object({
        type: z.string(),
        media_type: z.string().optional(),
        data: z.string().optional(),
        url: z.string().optional(),
      })
      .loose()
      .optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
    is_error: z.boolean().optional(),
  })
  .loose();

const anthropicMessageSchema = z.object({
  // Claude Code 2.x sends its environment prompt as {role:'system'} inside `messages` (B-024).
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([z.string(), z.array(anthropicBlockSchema)]),
});

const anthropicBodySchema = z
  .object({
    model: z.string().min(1),
    max_tokens: z.number().int().min(1).max(131_072),
    messages: z.array(anthropicMessageSchema).min(1),
    system: z.union([z.string(), z.array(anthropicBlockSchema)]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    tools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          input_schema: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    tool_choice: z
      .union([
        z.enum(['auto', 'any', 'none']),
        z.object({ type: z.enum(['auto', 'any', 'none']) }).loose(),
        z.object({ type: z.literal('tool'), name: z.string() }).loose(),
      ])
      .optional(),
    thinking: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type AnthropicNormalized = {
  request: ChatRequest;
  thinking: boolean;
};

function anthropicText(content: string | Array<{ text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => block.text ?? '')
    .filter(Boolean)
    .join('\n\n');
}

export function normalizeAnthropic(body: unknown): AnthropicNormalized {
  const data = parseWith(anthropicBodySchema, body);
  const messages: ChatMessage[] = [];
  const systemParts: string[] = [];
  if (data.system !== undefined) systemParts.push(anthropicText(data.system));
  for (const message of data.messages) {
    if (message.role === 'system') systemParts.push(anthropicText(message.content));
  }
  const systemText = systemParts.filter(Boolean).join('\n\n');
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const message of data.messages) {
    if (message.role === 'system') continue;
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    const toolResults: ChatMessage[] = [];
    const parts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        const source = block.source;
        if (source?.type === 'base64' && source.data && source.media_type) {
          parts.push({ type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } });
        } else if (source?.type === 'url' && source.url) {
          parts.push({ type: 'image_url', image_url: { url: source.url } });
        }
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        const text =
          typeof block.content === 'string'
            ? block.content
            : (block.content ?? [])
                .map((part) => (typeof part.text === 'string' ? part.text : ''))
                .join('');
        toolResults.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text });
      }
    }
    if (toolResults.length > 0) messages.push(...toolResults);
    if (toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: parts.length > 0 ? parts : '', tool_calls: toolCalls });
    } else if (parts.length > 0) {
      messages.push({ role: message.role, content: parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts });
    }
  }

  const tools: ChatTool[] | undefined = data.tools?.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  }));

  let toolChoice: ToolChoice | undefined;
  if (data.tool_choice === 'auto') toolChoice = 'auto';
  else if (data.tool_choice === 'any') toolChoice = 'required';
  else if (data.tool_choice === 'none') toolChoice = 'none';
  else if (typeof data.tool_choice === 'object') {
    if (data.tool_choice.type === 'auto') toolChoice = 'auto';
    else if (data.tool_choice.type === 'any') toolChoice = 'required';
    else if (data.tool_choice.type === 'none') toolChoice = 'none';
    else if (typeof data.tool_choice.name === 'string') {
      toolChoice = { type: 'function', function: { name: data.tool_choice.name } };
    }
  }

  return {
    request: {
      model: data.model,
      messages,
      stream: data.stream === true,
      maxTokens: data.max_tokens,
      temperature: data.temperature,
      topP: data.top_p,
      stop: data.stop_sequences,
      tools,
      toolChoice,
      protocol: 'messages',
    },
    thinking: data.thinking !== undefined,
  };
}

export function countInputTokens(body: unknown, fallbackModel: string): { tokens: number; model: string } {
  const data = body as { model?: unknown; system?: unknown; messages?: unknown; input?: unknown; instructions?: unknown };
  if (!data || typeof data !== 'object') return { tokens: 0, model: fallbackModel };
  const payload = JSON.stringify({
    system: data.system ?? data.instructions ?? '',
    messages: data.messages ?? data.input ?? '',
  });
  return { tokens: Math.ceil(payload.length / 4), model: typeof data.model === 'string' ? data.model : fallbackModel };
}