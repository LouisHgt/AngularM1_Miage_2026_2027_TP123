import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AudioContextService } from '../../shared/services/audio-context.service';
import { StudioStore } from '../../shared/services/studio.store';
import { TrackService } from '../../shared/services/track.service';
import { StudioPageComponent } from './studio-page';

const BUFFER = {} as AudioBuffer;

describe('StudioPageComponent', () => {
  let fixture: ComponentFixture<StudioPageComponent>;
  let component: StudioPageComponent;
  const audio = vi.fn();
  const decodeAudioData = vi.fn().mockResolvedValue(BUFFER);

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [StudioPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'track-1' })) } },
        { provide: TrackService, useValue: { audio } },
        { provide: AudioContextService, useValue: { getOrCreate: () => ({ decodeAudioData }) } },
      ],
    });
  });

  it('charge, décode et ajoute la piste au store', async () => {
    audio.mockReturnValue(of(new Blob(['audio'], { type: 'audio/mpeg' })));
    fixture = TestBed.createComponent(StudioPageComponent);
    component = fixture.componentInstance;

    await fixture.whenStable();

    expect(audio).toHaveBeenCalledWith('track-1');
    expect(decodeAudioData).toHaveBeenCalled();
    expect(component.studio.tracks()).toMatchObject([
      { id: 'track-1', name: 'Piste track-1', kind: 'original', buffer: BUFFER },
    ]);
    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('');
  });

  it('affiche une erreur si le téléchargement échoue', async () => {
    audio.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { message: 'Fichier introuvable' },
          }),
      ),
    );
    fixture = TestBed.createComponent(StudioPageComponent);
    component = fixture.componentInstance;

    await fixture.whenStable();

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Fichier introuvable');
    expect(component.studio.tracks()).toEqual([]);
  });
});
