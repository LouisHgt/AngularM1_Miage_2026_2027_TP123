import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { Track } from '../../shared/models/track.model';
import { NotificationService } from '../../shared/services/notification.service';
import { TracksPageComponent } from './tracks-page';

const TRACK: Track = {
  id: 'abc',
  title: 'Blues',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-01-01T10:00:00.000Z',
};

const PAGE = { items: [TRACK], page: 1, limit: 5, total: 1, pages: 1 };
const LIST_URL = '/api/tracks?page=1&limit=5';

describe('TracksPageComponent', () => {
  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let http: HttpTestingController;
  const dialog = { open: vi.fn() };
  const notify = { success: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: dialog },
        { provide: NotificationService, useValue: notify },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => http.verify());

  it('affiche une erreur lisible après un échec HTTP', () => {
    http.expectOne(LIST_URL).flush({ message: 'Base indisponible' }, { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(component.error()).toBe('Base indisponible');
    expect(component.loading()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Base indisponible');
  });

  it('affiche les pistes sous forme de cards', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    fixture.detectChanges();

    const card = (fixture.nativeElement as HTMLElement).querySelector('.track-card');
    expect(card?.textContent).toContain('Blues');
    expect(card?.textContent).toContain('2 Ko');
  });

  it('la suppression confirmée appelle DELETE /api/tracks/:id puis recharge la liste', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.remove(TRACK);
    expect(component.deletingId()).toBe('abc');

    const deletion = http.expectOne('/api/tracks/abc');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });

    expect(component.deletingId()).toBeNull();
    expect(notify.success).toHaveBeenCalled();
    http.expectOne(LIST_URL).flush({ ...PAGE, items: [], total: 0 });
    expect(component.tracks()).toEqual([]);
  });

  it('une suppression annulée ne déclenche aucune requête', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });

    component.remove(TRACK);

    http.expectNone('/api/tracks/abc');
  });

  it('une piste déjà supprimée (404) prévient et recharge la liste', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });

    component.remove(TRACK);
    http.expectOne('/api/tracks/abc').flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

    expect(notify.error).toHaveBeenCalled();
    http.expectOne(LIST_URL).flush({ ...PAGE, items: [], total: 0 });
  });

  it('l’upload met à jour la progression puis recharge la première page', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    component.file.set(new File(['abc'], 'song.mp3', { type: 'audio/mpeg' }));

    component.send();
    expect(component.upload().status).toBe('uploading');

    const upload = http.expectOne('/api/tracks');
    upload.event({ type: HttpEventType.UploadProgress, loaded: 30, total: 100 });
    expect(component.upload()).toMatchObject({ status: 'uploading', progress: 30 });

    upload.flush(TRACK, { status: 201, statusText: 'Created' });
    expect(component.upload().status).toBe('success');
    expect(component.file()).toBeNull();
    http.expectOne(LIST_URL).flush(PAGE);
  });

  it('l’upload affiche l’erreur renvoyée par le serveur', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    component.file.set(new File(['abc'], 'song.mp3', { type: 'audio/mpeg' }));

    component.send();
    http.expectOne('/api/tracks').flush({ message: 'Format audio non accepté' }, { status: 400, statusText: 'Bad Request' });

    expect(component.upload()).toMatchObject({ status: 'error', message: 'Format audio non accepté' });
  });

  it('refuse un fichier invalide avant tout appel HTTP', () => {
    http.expectOne(LIST_URL).flush(PAGE);
    component.file.set(new File(['abc'], 'notes.txt', { type: 'text/plain' }));

    component.send();

    expect(component.fileError()).toContain('Format non accepté');
    http.expectNone('/api/tracks');
  });
});
