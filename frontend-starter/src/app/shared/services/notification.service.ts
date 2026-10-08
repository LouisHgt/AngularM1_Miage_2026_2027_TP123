import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Thin wrapper around Angular Material's SnackBar for success and error toasts. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'OK', { duration: 4000, panelClass: 'snack-success' });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Fermer', { duration: 6000, panelClass: 'snack-error' });
  }
}
