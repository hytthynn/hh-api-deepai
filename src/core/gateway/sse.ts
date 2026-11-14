export type SseEvent = { event: string | null; data: string };

/** Incremental text/event-stream parser. Accepts arbitrary chunk boundaries. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let separator = this.buffer.indexOf('\n\n');
    while (separator !== -1) {
      const raw = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      const event = parseBlock(raw);
      if (event) events.push(event);
      separator = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  flush(): SseEvent[] {
    const raw = this.buffer.trim();
    this.buffer = '';
    if (!raw) return [];
    const event = parseBlock(raw);
    return event ? [event] : [];
  }
}

function parseBlock(raw: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith(':')) continue;
  }
  if (data.length === 0 && event === null) return null;
  return { event, data: data.join('\n') };
}

export function sseFrame(event: string | null, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return event ? `event: ${event}\ndata: ${payload}\n\n` : `data: ${payload}\n\n`;
}

export function chatSseFrame(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

export async function* iterateSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const events = parser.push(decoder.decode(value, { stream: true }));
      for (const event of events) yield event;
    }
    const rest = decoder.decode();
    const tail = rest ? parser.push(rest) : [];
    for (const event of [...tail, ...parser.flush()]) yield event;
  } finally {
    reader.releaseLock();
  }
}

/** Wraps an async generator of pre-serialized SSE frames into a byte stream. */
export function streamFromGenerator(
  generator: AsyncGenerator<string>,
  options: { onError?: (error: unknown) => string | null; onClose?: () => void } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    try {
      options.onClose?.();
    } catch {
      // release hooks must never break the response
    }
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const frame of generator) controller.enqueue(encoder.encode(frame));
      } catch (error) {
        const frame = options.onError?.(error);
        if (frame) controller.enqueue(encoder.encode(frame));
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
        close();
      }
    },
    async cancel() {
      try {
        await generator.return(undefined);
      } finally {
        close();
      }
    },
  });
}

export function readSseBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error('upstream response has no body');
  return response.body;
}