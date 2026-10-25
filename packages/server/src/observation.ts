export type ObservationErrorCode = 'upstream' | 'invalid_response'

export class ObservationError extends Error {
  constructor(
    public readonly code: ObservationErrorCode,
    public readonly retryable = false,
  ) {
    super(code)
  }
}

export function isGameVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}\.\d{2}\.\d{2}\.\d{4}\.\d{4}$/.test(value)
  )
}

export function checkHttp(response: Response) {
  if (!response.ok) {
    throw new ObservationError(
      'upstream',
      response.status === 429 || response.status >= 500,
    )
  }
}
