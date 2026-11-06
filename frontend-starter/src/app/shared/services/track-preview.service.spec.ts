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
    buffer: {} as AudioBuffer,
  });
  let sources: ReturnType<typeof fakeSource>[];
  let context: { state: string; resume: ReturnType<typeof vi.fn>; destination: object };

  beforeEach(() => {
    sources = [];
    context = { state: 'suspended', resume: vi.fn().mockResolvedValue(undefined), destination: {} };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AudioContextService,
          useValue: {
            getOrCreate: () => ({
              ...context,
              createBufferSource: () => {
                const source = fakeSource();
                sources.push(source);
                return source;
              },
            }),
          },
        },
      ],
    });
  });

  it('reprend le contexte puis joue la piste', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    expect(sources[0].start).toHaveBeenCalled();
    expect(service.playingId()).toBe('a');
  });

  it('un second appel sur la même piste l’arrête', async () => {
    const service = TestBed.inject(TrackPreviewService);
    await service.toggle(track('a'));
    await service.toggle(track('a'));
    expect(sources[0].stop).toHaveBeenCalled();
    expect(service.playingId()).toBeNull();
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
    TestBed.inject(AudioContextService).getOrCreate = () => {
      throw new Error('Web Audio indisponible');
    };
    await service.toggle(track('a'));
    expect(service.error()).toBe('Web Audio indisponible');
    expect(service.playingId()).toBeNull();
  });
});
