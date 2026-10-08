import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Track } from '../../shared/models/track.model';
import { IDLE_UPLOAD, UploadState } from '../../shared/models/upload-state.model';
import { FileSizePipe } from '../../shared/pipes/file-size.pipe';
import { NotificationService } from '../../shared/services/notification.service';
import { TrackService } from '../../shared/services/track.service';
import { apiErrorMessage } from '../../shared/utils/api-error';
import { validateAudioFile } from '../../shared/utils/audio-file';
import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog';

@Component({
  imports: [ReactiveFormsModule, DatePipe, FileSizePipe, MatProgressBarModule],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly loading = signal(false);
  readonly error = signal('');

  /** Upload form state. */
  readonly title = new FormControl('', { nonNullable: true });
  readonly file = signal<File | null>(null);
  readonly fileError = signal('');
  readonly upload = signal<UploadState>(IDLE_UPLOAD);

  /** Playback state. */
  readonly audioUrl = signal('');
  readonly nowPlaying = signal<Track | null>(null);
  readonly audioError = signal('');

  /** Id of the track being deleted (prevents double clicks). */
  readonly deletingId = signal<string | null>(null);

  constructor() {
    this.load();
    // The last ObjectURL is revoked when the component is destroyed (memory leak otherwise).
    inject(DestroyRef).onDestroy(() => this.revokeAudioUrl());
  }

  choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file.set(file);
    this.fileError.set(file ? (validateAudioFile(file) ?? '') : '');
    this.upload.set(IDLE_UPLOAD);
    console.debug('[TracksPage] Fichier sélectionné', file?.name);
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.service.list(this.page()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        this.tracks.set(response.items);
        this.pages.set(response.pages);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        console.error('[TracksPage] Chargement impossible');
        this.error.set(apiErrorMessage(error, 'Impossible de charger les pistes'));
        this.loading.set(false);
      },
    });
  }

  go(page: number): void {
    this.page.set(page);
    this.load();
  }

  send(): void {
    const file = this.file();
    const validationError = validateAudioFile(file);
    if (!file || validationError) {
      this.fileError.set(validationError ?? '');
      return;
    }
    if (this.upload().status === 'uploading') {
      return; // a second submission while uploading is ignored
    }

    this.upload.set({ status: 'uploading', progress: 0, message: '' });
    this.service.upload(file, this.title.value.trim() || file.name).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          // Angular forwards the XHR `progress` events: loaded / total bytes.
          const progress = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
          this.upload.set({ status: 'uploading', progress, message: '' });
        } else if (event.type === HttpEventType.Response) {
          console.debug('[TracksPage] Piste envoyée', event.body?.id);
          this.upload.set({ status: 'success', progress: 100, message: 'Piste ajoutée à la bibliothèque.' });
          this.notify.success('Piste envoyée.');
          this.resetForm();
          this.page.set(1);
          this.load();
        }
      },
      error: (error: unknown) => {
        console.error('[TracksPage] Envoi impossible');
        this.upload.set({
          status: 'error',
          progress: 0,
          message: apiErrorMessage(error, 'Envoi impossible'),
        });
      },
    });
  }

  play(track: Track): void {
    this.audioError.set('');
    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id);
        this.revokeAudioUrl();
        this.audioUrl.set(URL.createObjectURL(blob));
        this.nowPlaying.set(track);
      },
      error: (error: unknown) => {
        console.error('[TracksPage] Lecture impossible');
        this.audioError.set(apiErrorMessage(error, 'Lecture impossible'));
      },
    });
  }

  onAudioError(): void {
    this.audioError.set('Le navigateur ne parvient pas à lire ce fichier audio.');
  }

  remove(track: Track): void {
    if (this.deletingId()) {
      return;
    }
    const data: ConfirmDialogData = {
      title: 'Supprimer la piste',
      message: `Supprimer « ${track.title} » ? Cette action est définitive.`,
      confirmLabel: 'Supprimer',
      danger: true,
    };
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe({
        next: (confirmed) => {
          if (confirmed) {
            this.deleteConfirmed(track);
          }
        },
        error: () => console.error('[TracksPage] Dialogue de confirmation interrompu'),
      });
  }

  private deleteConfirmed(track: Track): void {
    this.deletingId.set(track.id);
    this.service.delete(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.deletingId.set(null);
        this.notify.success(`« ${track.title} » supprimée.`);
        if (this.nowPlaying()?.id === track.id) {
          this.stopPlayback();
        }
        this.reloadAfterRemoval();
      },
      error: (error: unknown) => {
        this.deletingId.set(null);
        if (error instanceof HttpErrorResponse && error.status === 404) {
          // Deleted elsewhere (another tab) or not owned by this user: the list is simply refreshed.
          console.warn('[TracksPage] Piste déjà supprimée ou inaccessible', track.id);
          this.notify.error('Cette piste n’existe plus : la liste a été actualisée.');
          this.reloadAfterRemoval();
          return;
        }
        console.error('[TracksPage] Suppression impossible');
        this.notify.error(apiErrorMessage(error, 'Suppression impossible'));
      },
    });
  }

  /** After a removal, step back one page if the current page became empty. */
  private reloadAfterRemoval(): void {
    if (this.tracks().length === 1 && this.page() > 1) {
      this.page.update((page) => page - 1);
    }
    this.load();
  }

  private resetForm(): void {
    this.title.setValue('');
    this.file.set(null);
    this.fileError.set('');
    const input = document.querySelector<HTMLInputElement>('#track-file');
    if (input) {
      input.value = '';
    }
  }

  private stopPlayback(): void {
    this.revokeAudioUrl();
    this.audioUrl.set('');
    this.nowPlaying.set(null);
  }

  private revokeAudioUrl(): void {
    const previousUrl = this.audioUrl();
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
  }
}
