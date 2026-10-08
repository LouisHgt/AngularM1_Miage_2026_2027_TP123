import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';

/**
 * These tests never reach the backend nor MongoDB: HttpTestingController
 * intercepts the requests and lets the test answer them.
 */
describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('login() envoie POST /api/auth/login avec le bon corps et stocke la session', () => {
    let received: unknown;
    service.login('demo@example.com', 'Demo1234!').subscribe({
      next: (response) => (received = response),
      error: () => {
        throw new Error('login should not fail');
      },
    });

    const request = http.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'demo@example.com', password: 'Demo1234!' });

    const user = { id: 'u1', name: 'Demo', email: 'demo@example.com', createdAt: '2026-01-01' };
    request.flush({ token: 'jwt-test', user });

    expect(received).toEqual({ token: 'jwt-test', user });
    expect(service.token()).toBe('jwt-test');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser()?.name).toBe('Demo');
    expect(localStorage.getItem('gpc_token')).toBe('jwt-test');
  });

  it('login() ne stocke rien lorsque le backend répond 401', () => {
    let failed = false;
    service.login('demo@example.com', 'wrong').subscribe({
      next: () => {
        throw new Error('login should fail');
      },
      error: () => (failed = true),
    });

    http
      .expectOne('/api/auth/login')
      .flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(service.token()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('logout() nettoie le token, le profil et le localStorage', () => {
    localStorage.setItem('gpc_token', 'old');
    service.token.set('old');
    service.currentUser.set({ id: 'u1', name: 'Demo', email: 'demo@example.com', createdAt: '' });

    service.logout();

    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });
});
