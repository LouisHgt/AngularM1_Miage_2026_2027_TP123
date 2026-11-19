import { TestBed } from '@angular/core/testing';
import { StudioTrack } from '../models/studio-track.model';
import { AudioContextService } from './audio-context.service';
import { TrackPreviewService } from './track-preview.service';

function fakeSource() {
  return {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe('TrackPreviewService', () => {
  const track = (id: string): StudioTrack => ({
    id,
    name: id,
    kind: 'stem',
    buffer: { duration: 100 } as AudioBuffer,
  });
  let sources: ReturnType<typeof fakeSource>[];
  let context: {
    state: string;
    currentTime: number;
    resume: ReturnType<typeof vi.fn>;
    destination: object;
    createBufferSource: () => ReturnType<typeof fakeSource>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    context = {
      state: 'suspended',
      currentTime: 10,
      resume: vi.fn().mockResolvedValue(undefined),
      destination: {},
      createBufferSource: () => {
        const source = fakeSource();
        sources.push(source);
        return source;
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: AudioContextService, useValue: { getOrCreate: () => context } }],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('reprend le contexte puis joue la piste depuis le début', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    expect(context.resume).toHaveBeenCalled();
    expect(sources[0].start).toHaveBeenCalledWith(0, 0);
    expect(service.playingId()).toBe('a');
    expect(service.duration()).toBe(100);
  });

  it('met à jour la position pendant la lecture', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    context.currentTime = 15;
    vi.advanceTimersByTime(200);
    expect(service.position()).toBe(5);
  });

  it('seek relance la lecture à la position demandée', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    await service.seek(40);
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources[1].start).toHaveBeenCalledWith(0, 40);
    context.currentTime = 12;
    vi.advanceTimersByTime(200);
    expect(service.position()).toBe(42);
    expect(service.playingId()).toBe('a');
  });

  it('borne le seek à la durée de la piste', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    await service.seek(500);
    expect(sources[1].start).toHaveBeenCalledWith(0, 100);
  });

  it('un second appel sur la même piste l’arrête et remet la position à zéro', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    await service.toggle(track('a'));
    expect(sources[0].stop).toHaveBeenCalled();
    expect(service.playingId()).toBeNull();
    expect(service.position()).toBe(0);
  });

  it('jouer une autre piste arrête la précédente', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    await service.toggle(track('b'));
    expect(sources[0].stop).toHaveBeenCalled();
    expect(service.playingId()).toBe('b');
  });

  it('remet l’état à zéro à la fin naturelle de la lecture', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    sources[0].onended?.();
    expect(service.playingId()).toBeNull();
  });

  it('signale une erreur de lecture', async () => {
    const service = TestBed.inject(TrackPreviewService);
    context.createBufferSource = () => {
      throw new Error('Web Audio indisponible');
    };
    await service.toggle(track('a'));
    expect(service.error()).toBe('Web Audio indisponible');
    expect(service.playingId()).toBeNull();
  });
});
