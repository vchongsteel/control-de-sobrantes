import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { timeout, TimeoutError } from 'rxjs';

@Component({
  selector: 'app-registro',
  templateUrl: './registro.page.html',
  styleUrls: ['./registro.page.scss'],
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent],
})
export class RegistroPage {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);

  nombre = '';
  usuario = '';
  correo = '';
  contrasena = '';
  confirmarContrasena = '';

  cargando = false;
  registrado = false;
  mensaje = '';

  registrar(formulario: NgForm): void {
    if (this.cargando || this.registrado) {
      return;
    }

    this.mensaje = '';

    if (formulario.invalid || this.nombre.trim().length < 2) {
      formulario.control.markAllAsTouched();
      this.mensaje = 'Completa correctamente todos los campos.';
      return;
    }

    if (this.contrasena !== this.confirmarContrasena) {
      this.mensaje = 'Las contraseñas no coinciden.';
      return;
    }

    if (new TextEncoder().encode(this.contrasena).length > 72) {
      this.mensaje = 'La contraseña supera el máximo de 72 bytes.';
      return;
    }

    this.cargando = true;

    this.http.post<{ mensaje: string }>(
      'http://localhost:3000/api/registro',
      {
        nombre: this.nombre.trim(),
        usuario: this.usuario.trim(),
        correo: this.correo.trim().toLowerCase(),
        contrasena: this.contrasena,
      }
    ).pipe(
      timeout(15000)
    ).subscribe({
      next: (respuesta) => {
        this.cargando = false;
        this.registrado = true;
        this.contrasena = '';
        this.confirmarContrasena = '';
        this.mensaje = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;

        if (error instanceof TimeoutError) {
          this.mensaje =
            'No llegó la confirmación a tiempo. La cuenta podría haberse creado; comprueba el acceso antes de intentarlo otra vez.';
        } else if (error instanceof HttpErrorResponse) {
          this.mensaje = error.status === 0
            ? 'No se pudo conectar con el servidor.'
            : error.error?.mensaje || 'No se pudo registrar la cuenta.';
        } else {
          this.mensaje = 'Ocurrió un error inesperado.';
        }

        this.detector.markForCheck();
      },
    });
  }
}