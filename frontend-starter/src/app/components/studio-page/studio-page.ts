import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, from, of, switchMap, take } from 'rxjs';
import { AudioContextService } from '../../shared/services/audio-context.service';
import { StemSeparationMode } from '../../shared/models/stem-separation.model';
import { StemSeparationService } from '../../shared/services/stem-separation.service';
import { StudioStore } from '../../shared/services/studio.store';
import { TrackService } from '../../shared/services/track.service';
import { apiErrorMessage } from '../../shared/utils/api-error';

@Component({
  imports: [RouterLink],
  templateUrl: './studio-page.html',
  styleUrl: './studio-page.css',
})
export class StudioPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly trackService = inject(TrackService);
  private readonly audioContext = inject(AudioContextService);
  readonly stemSeparation = inject(StemSeparationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly studio = inject(StudioStore);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly selectedSeparationMode = signal<StemSeparationMode>('fast');
  readonly separationError = signal('');

  constructor() {
    const subscription = this.route.paramMap
      .pipe(
        take(1),
        switchMap((params) => {
          const id = params.get('id');
          if (!id) {
            return of({ error: 'Identifiant de piste manquant.' });
          }
          this.loading.set(true);
          this.error.set('');
          return this.trackService.audio(id).pipe(
            switchMap((blob) =>
              from(blob.arrayBuffer()).pipe(
                switchMap((data) => from(this.audioContext.getOrCreate().decodeAudioData(data))),
                switchMap((buffer) => of({ id, buffer })),
              ),
            ),
            catchError((requestError: unknown) =>
              of({ error: apiErrorMessage(requestError, 'Impossible de charger la piste dans le studio.') }),
            ),
          );
        }),
      )
      .subscribe({
        next: (result) => {
          if ('error' in result) {
            this.error.set(result.error);
          } else {
            this.studio.addTrack({
              id: result.id,
              name: `Piste ${result.id}`,
              kind: 'original',
              buffer: result.buffer,
            });
          }
          this.loading.set(false);
        },
        error: (subscriptionError: unknown) => {
          this.error.set(apiErrorMessage(subscriptionError, 'Impossible de charger le studio.'));
          this.loading.set(false);
        },
      });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
    this.destroyRef.onDestroy(() => this.stemSeparation.dispose());
  }

  separateOriginal(): void {
    const original = this.studio.tracks().find((track) => track.kind === 'original');
    if (!original) {
      this.separationError.set('Aucune piste originale n’est disponible.');
      return;
    }

    this.separationError.set('');
    this.stemSeparation
      .separate(original.id, this.selectedSeparationMode())
      .catch((separationError: unknown) => {
        this.separationError.set(
          separationError instanceof Error ? separationError.message : 'La séparation a échoué.',
        );
      });
  }
}
