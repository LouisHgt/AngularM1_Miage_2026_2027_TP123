import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { AuthResponse } from '../models/auth-response.model';
import { User } from '../models/user.model';

const TOKEN_KEY = 'gpc_token';

/**
 * Handles authentication and the current user's profile.
 * The token is persisted in localStorage (survives a reload) and mirrored in a Signal
 * (read synchronously and reactively by the guard, the interceptor and the templates).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly currentUser = signal<User | null>(null);
  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  readonly isAuthenticated = computed(() => this.token() !== null);

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/login', { email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  register(name: string, email: string, password: string) {
    return this.http
      .post<AuthResponse>('/api/auth/register', { name, email, password })
      .pipe(tap((response) => this.storeAuthentication(response)));
  }

  profile() {
    return this.http
      .get<User>('/api/users/me')
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  update(name: string) {
    return this.http
      .put<User>('/api/users/me', { name })
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.currentUser.set(null);
  }

  private storeAuthentication(response: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, response.token);
    this.token.set(response.token);
    this.currentUser.set(response.user);
  }
}
