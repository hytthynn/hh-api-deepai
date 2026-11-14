export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type ContentPart = TextPart | ImagePart;

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatTool = {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
};

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  tools?: ChatTool[];
  toolChoice?: ToolChoice;
  responseFormat?: Record<string, unknown>;
  parallelToolCalls?: boolean;
  protocol: 'chat' | 'responses' | 'messages';
};

export type UpstreamResult = {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  id: string;
  model: string;
  created: number;
};

export function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function hasImageContent(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  );
}

export function approximateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.ceil(text.length / 4);
}