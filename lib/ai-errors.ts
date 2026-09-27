export type OpenAIErrorKind =
  | 'missing_key'
  | 'byok_required'
  | 'credential_unavailable'
  | 'authentication'
  | 'credits'
  | 'rate_limit'
  | 'access'
  | 'invalid_output'
  | 'api_error';

export class OpenAIResearchError extends Error {
  constructor(
    public kind: OpenAIErrorKind,
    public status: number,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'OpenAIResearchError';
  }
}

// Never forward provider exception bodies (they can contain credentials).
export function redactAISecrets(value: string, exactSecret?: string) {
  return (exactSecret ? value.split(exactSecret).join('[已隐藏密钥]') : value)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[已隐藏密钥]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [已隐藏]');
}
