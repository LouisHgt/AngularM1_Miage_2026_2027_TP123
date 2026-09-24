import { HttpErrorResponse } from '@angular/common/http';

/** Builds a user-facing message from an API error, without exposing technical details. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Serveur injoignable : vérifiez que le backend est lancé.';
    }
    const message = (error.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return fallback;
}
