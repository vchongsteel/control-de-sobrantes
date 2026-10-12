import {
  Component,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  HttpClient,
  HttpErrorResponse,
} from '@angular/common/http';
import { IonContent } from '@ionic/angular';
import { Router, RouterLink } from '@angular/router';
import { timeout, TimeoutError } from 'rxjs';

interface RespuestaLogin {
  mensaje: string;
  token: string;
  usuario: {
    id: string;
    nombre: string;
    usuario: string;
  };
}

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [FormsModule, IonContent, RouterLink],
})
export class LoginPage {
  private http = inject(HttpClient);
  private router = inject(Router);
  private detector = inject(ChangeDetectorRef);

  usuario = '';
  contrasena = '';
  mostrarContrasena = false;
  mensaje = '';
  cargando = false;

  alternarContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  iniciarSesion(): void {
    if (this.cargando) {
      return;
    }

    if (!this.usuario.trim() || !this.contrasena) {
      this.mensaje = 'Completa el usuario y la contraseña.';
      return;
    }

    this.cargando = true;
    this.mensaje = 'Comprobando credenciales…';

    this.http.post<RespuestaLogin>(
      'http://localhost:3000/api/login',
      {
        usuario: this.usuario.trim(),
        contrasena: this.contrasena,
      }
    ).pipe(
      timeout(10000)
    ).subscribe({
      next: async (respuesta) => {
        this.mensaje = 'Comprobando sesión…';
        this.detector.markForCheck();

        try {
          if (
            typeof respuesta.token !== 'string' ||
            !respuesta.token.trim()
          ) {
            sessionStorage.removeItem('token');
            this.mensaje =
              'El servidor no devolvió el token de sesión.';
            return;
          }

          sessionStorage.setItem('token', respuesta.token);
          this.contrasena = '';

          const navegacionCorrecta =
            await this.router.navigateByUrl(
              '/principal/inicio',
              { replaceUrl: true }
            );

          if (this.router.url.startsWith('/login')) {
            this.mensaje = 'No se pudo validar la sesión.';
          } else if (!navegacionCorrecta) {
            this.mensaje =
              'No se pudo abrir la pantalla principal.';
          } else {
            this.mensaje = '';
          }
        } catch {
          this.mensaje =
            'Ocurrió un error al abrir la pantalla principal.';
        } finally {
          this.cargando = false;
          this.detector.markForCheck();
        }
      },

      error: (error: unknown) => {
        this.cargando = false;

        if (error instanceof TimeoutError) {
          this.mensaje =
            'El servidor tardó demasiado en responder.';
        } else if (error instanceof HttpErrorResponse) {
          this.mensaje = error.status === 0
            ? 'No se pudo conectar con el servidor.'
            : error.error?.mensaje ||
              'No se pudo comprobar el acceso.';
        } else {
          this.mensaje = 'Ocurrió un error inesperado.';
        }

        this.detector.markForCheck();
      },
    });
  }
}