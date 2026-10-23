import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { timeout, TimeoutError } from 'rxjs';

@Component({
  selector: 'app-restablecer-contrasena',
  templateUrl: './restablecer-contrasena.page.html',
  styleUrls: ['./restablecer-contrasena.page.scss'],
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent],
})
export class RestablecerContrasenaPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private detector = inject(ChangeDetectorRef);
  private token = '';

  contrasena = '';
  confirmacion = '';
  cargando = false;
  completado = false;
  tieneToken = false;
  mensaje = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    this.tieneToken = !!this.token;

    if (!this.tieneToken) {
      this.mensaje =
        'Abre esta pantalla desde el enlace de recuperación.';
    }
  }

  restablecer(formulario: NgForm): void {
    if (this.cargando || this.completado || !this.tieneToken) {
      return;
    }

    this.mensaje = '';

    if (formulario.invalid) {
      formulario.control.markAllAsTouched();
      this.mensaje = 'Usa una contraseña de al menos 8 caracteres.';
      return;
    }

    if (this.contrasena !== this.confirmacion) {
      this.mensaje = 'Las contraseñas no coinciden.';
      return;
    }

    if (new TextEncoder().encode(this.contrasena).length > 72) {
      this.mensaje = 'La contraseña supera el máximo de 72 bytes.';
      return;
    }

    this.cargando = true;

    this.http.post<{ mensaje: string }>(
      'http://localhost:3000/api/restablecer-contrasena',
      {
        token: this.token,
        contrasena: this.contrasena,
      }
    ).pipe(
      timeout(15000)
    ).subscribe({
      next: (respuesta) => {
        sessionStorage.removeItem('token');
        this.completado = true;
        this.cargando = false;
        this.contrasena = '';
        this.confirmacion = '';
        this.token = '';
        this.mensaje = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;

        if (error instanceof TimeoutError) {
          this.mensaje =
            'No llegó la confirmación. Intenta iniciar sesión con la contraseña nueva para comprobar el resultado.';
        } else if (error instanceof HttpErrorResponse) {
          this.mensaje = error.status === 0
            ? 'No se pudo conectar con el servidor.'
            : error.error?.mensaje ||
              'No se pudo cambiar la contraseña.';
        } else {
          this.mensaje = 'Ocurrió un error inesperado.';
        }

        this.detector.markForCheck();
      },
    });
  }
}