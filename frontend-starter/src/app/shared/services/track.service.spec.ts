import { TestBed } from '@angular/core/testing';
import { HttpEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Track } from '../models/track.model';
import { TrackService } from './track.service';

const TRACK: Track = {
  id: 't1',
  title: 'Blues',
  originalName: 'blues.mp3',
  mimeType: 'audio/mpeg',
  size: 1234,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('TrackService', () => {
  let service: TrackService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() transmet page et limit en paramètres de requête', () => {
    service.list(2, 10).subscribe({ next: () => undefined, error: () => undefined });

    const request = http.expectOne((req) => req.url === '/api/tracks');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('10');
    request.flush({ items: [TRACK], page: 2, limit: 10, total: 11, pages: 2 });
  });

  it('delete() appelle DELETE /api/tracks/:id', () => {
    let completed = false;
    service.delete('abc').subscribe({ next: () => (completed = true), error: () => undefined });

    const request = http.expectOne('/api/tracks/abc');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });

  it('upload() envoie un multipart audio + title et émet les événements de progression', () => {
    const file = new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    const events: HttpEvent<Track>[] = [];
    service.upload(file, 'Mon titre').subscribe({ next: (event) => events.push(event), error: () => undefined });

    const request = http.expectOne('/api/tracks');
    expect(request.request.method).toBe('POST');
    expect(request.request.reportProgress).toBe(true);
    const body = request.request.body as FormData;
    expect(body.get('title')).toBe('Mon titre');
    expect((body.get('audio') as File).name).toBe('song.mp3');

    request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    request.flush(TRACK);

    const progress = events.find((event) => event.type === HttpEventType.UploadProgress);
    expect(progress).toMatchObject({ loaded: 50, total: 100 });
    const response = events.find((event) => event.type === HttpEventType.Response);
    expect(response).toMatchObject({ body: TRACK });
  });

  it('audio() demande un Blob authentifié', () => {
    service.audio('t1').subscribe({ next: () => undefined, error: () => undefined });
    const request = http.expectOne('/api/tracks/t1/audio');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['x'], { type: 'audio/mpeg' }));
  });
});
