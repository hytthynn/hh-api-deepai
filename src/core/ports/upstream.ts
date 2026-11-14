import type { ChatRequest, UpstreamResult } from '../gateway/types';
import type { TheosSnapshot } from '../accounts/balance';
import type { UpstreamModel } from '../entities/model';

export type UpstreamCookie = { name: string; value: string; domain: string };

export type UpstreamCredentials = {
  cookies: UpstreamCookie[];
  machine: string | null;
  laneVersion: number | null;
};

export type UpstreamCall = {
  signal: AbortSignal;
  timeoutMs?: number;
};

export type UpstreamResponse = {
  status: number;
  headers: Headers;
  bodyText: string;
};

export type UpstreamStream = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  controller: AbortController;
};

export type UpstreamPort = {
  theos(credentials: UpstreamCredentials, call: UpstreamCall): Promise<{ status: number; body: unknown }>;
  models(credentials: UpstreamCredentials, call: UpstreamCall): Promise<{ status: number; body: unknown }>;
  chatJson(credentials: UpstreamCredentials, request: ChatRequest, call: UpstreamCall): Promise<UpstreamResponse>;
  chatStream(credentials: UpstreamCredentials, request: ChatRequest, call: UpstreamCall): Promise<UpstreamStream>;
  complete(credentials: UpstreamCredentials, request: ChatRequest, call: UpstreamCall): Promise<UpstreamResult>;
};

export type TheosResult = TheosSnapshot;
export type ModelsResult = UpstreamModel[];