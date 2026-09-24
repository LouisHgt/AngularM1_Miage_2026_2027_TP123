import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { apiErrorMessage } from '../../shared/utils/api-error';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent {
  readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
  });

  constructor() {
    // The profile is fetched from GET /api/users/me each time the page is opened.
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.loading.set(false);
        this.form.setValue({ name: user.name });
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Chargement impossible');
        this.loading.set(false);
        this.error.set(apiErrorMessage(error, 'Impossible de charger le profil'));
      },
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    this.auth.update(this.form.getRawValue().name.trim()).subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil enregistré', user.id);
        this.saving.set(false);
        this.success.set('Nom mis à jour.');
        this.form.markAsPristine();
      },
      error: (error: unknown) => {
        console.error('[ProfilePage] Enregistrement impossible');
        this.saving.set(false);
        this.error.set(apiErrorMessage(error, 'Impossible d’enregistrer le profil'));
      },
    });
  }
}
