import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { apiErrorMessage } from '../../shared/utils/api-error';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly error = signal('');
  readonly loading = signal(false);
  readonly sessionExpired = this.route.snapshot.queryParamMap.has('expired');

  readonly form = new FormGroup({
    email: new FormControl('demo@example.com', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('Demo1234!', {
      nonNullable: true,
      validators: [Validators.required],
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
    this.auth.login(values.email, values.password).subscribe({
      next: () => {
        console.debug('[LoginPage] Connexion réussie');
        this.loading.set(false);
        // Only accept an internal path (no "//host") to avoid an open redirect.
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const target = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/tracks';
        void this.router.navigateByUrl(target);
      },
      error: (error: unknown) => {
        console.error('[LoginPage] Échec de connexion');
        this.loading.set(false);
        this.error.set(apiErrorMessage(error, 'Erreur de connexion'));
      },
    });
  }
}
