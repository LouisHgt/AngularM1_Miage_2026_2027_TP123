import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { apiErrorMessage } from '../../shared/utils/api-error';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
  styleUrl: './register-page.css',
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly loading = signal(false);

  // Same rules as the backend (User.js: name >= 2 chars, app.js: password >= 8 chars).
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set('');
    const values = this.form.getRawValue();
    this.auth.register(values.name.trim(), values.email, values.password).subscribe({
      next: () => {
        console.debug('[RegisterPage] Inscription réussie');
        this.loading.set(false);
        void this.router.navigateByUrl('/profile');
      },
      error: (error: unknown) => {
        console.error('[RegisterPage] Échec de l’inscription');
        this.loading.set(false);
        this.error.set(apiErrorMessage(error, 'Erreur d’inscription'));
      },
    });
  }
}
