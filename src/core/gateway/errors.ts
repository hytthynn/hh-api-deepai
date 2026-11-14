export type GatewayErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'rate_limit_exceeded'
  | 'no_account_available'
  | 'model_not_found'
  | 'unsupported_parameter'
  | 'unsupported_content'
  | 'invalid_request'
  | 'previous_response_not_found'
  | 'all_accounts_failed'
  | 'upstream_timeout'
  | 'csrf_failed'
  | 'unauthorized'
  | 'not_found'
  | 'internal_error'
  | 'bad_request';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly details?: string;
  readonly retryAfterSec?: number;
  attempts?: number;
  accountId?: number | null;

  constructor(
    code: GatewayErrorCode,
    status: number,
    message: string,
    options: { details?: string; retryAfterSec?: number; attempts?: number; accountId?: number | null } = {},
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.retryAfterSec = options.retryAfterSec;
    this.attempts = options.attempts;
    this.accountId = options.accountId;
  }
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError;
}

/** Non-retryable upstream client error (400/422) that must be returned verbatim. */
export class UpstreamClientError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, bodyText: string) {
    super(bodyText.slice(0, 500) || `upstream ${status}`);
    this.name = 'UpstreamClientError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}