import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => controller.verify());

  it('ajoute Authorization: Bearer <token> aux requêtes protégées', () => {
    auth.token.set('jwt-test');
    http.get('/api/tracks').subscribe({ next: () => undefined, error: () => undefined });

    const request = controller.expectOne('/api/tracks');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-test');
    request.flush({});
  });

  it('n’ajoute pas de header sans token ni sur les routes publiques', () => {
    http.get('/api/health').subscribe({ next: () => undefined, error: () => undefined });
    expect(controller.expectOne('/api/health').request.headers.has('Authorization')).toBe(false);

    auth.token.set('jwt-test');
    http.post('/api/auth/login', {}).subscribe({ next: () => undefined, error: () => undefined });
    expect(controller.expectOne('/api/auth/login').request.headers.has('Authorization')).toBe(false);
  });

  it('sur un 401, déconnecte et redirige vers /login', () => {
    auth.token.set('expired');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let status = 0;
    http.get('/api/users/me').subscribe({
      next: () => undefined,
      error: (error) => (status = error.status),
    });

    controller
      .expectOne('/api/users/me')
      .flush({ message: 'Jeton invalide ou expiré' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(auth.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.objectContaining({ queryParams: expect.objectContaining({ expired: true }) }));
  });
});
