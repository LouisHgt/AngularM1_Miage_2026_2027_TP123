import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Public routes: they neither need the token nor trigger a logout on 401 (e.g. wrong password). */
const PUBLIC_API_URLS = ['/api/auth/login', '/api/auth/register'];

/**
 * Adds the bearer token to protected API requests.
 * If the API answers 401 (missing, invalid or expired token), clears the local session
 * and redirects to /login, remembering the page the user was on.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (PUBLIC_API_URLS.includes(request.url)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();

  const authorizedRequest = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        console.warn('[authInterceptor] 401 reçu : session expirée ou invalide');
        auth.logout();
        void router.navigate(['/login'], {
          queryParams: { expired: true, returnUrl: router.url },
        });
      }
      return throwError(() => error);
    }),
  );
};
