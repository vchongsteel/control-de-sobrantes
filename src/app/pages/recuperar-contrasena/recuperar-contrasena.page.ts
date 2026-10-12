import {
  Component,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { timeout, TimeoutError } from 'rxjs';

@Component({
  selector: 'app-recuperar-contrasena',
  templateUrl: './recuperar-contrasena.page.html',
  styleUrls: ['./recuperar-contrasena.page.scss'],
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent],
})
export class RecuperarContrasenaPage {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);

  correo = '';
  cargando = false;
  mensaje = '';

  solicitar(formulario: NgForm): void {
    if (this.cargando) {
      return;
    }

    this.mensaje = '';

    if (formulario.invalid) {
      formulario.control.markAllAsTouched();
      this.mensaje = 'Escribe un correo válido.';
      return;
    }

    this.cargando = true;

    this.http.post<{ mensaje: string }>(
      'http://localhost:3000/api/recuperar-contrasena',
      { correo: this.correo.trim().toLowerCase() }
    ).pipe(
      timeout(15000)
    ).subscribe({
      next: (respuesta) => {
        this.cargando = false;
        this.mensaje = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;

        if (error instanceof TimeoutError) {
          this.mensaje =
            'No llegó la confirmación a tiempo. Revisa tu correo antes de volver a solicitar el enlace.';
        } else if (error instanceof HttpErrorResponse) {
          this.mensaje = error.status === 0
            ? 'No se pudo conectar con el servidor.'
            : error.error?.mensaje ||
              'No se pudo solicitar la recuperación.';
        } else {
          this.mensaje = 'Ocurrió un error inesperado.';
        }

        this.detector.markForCheck();
      },
    });
  }
}