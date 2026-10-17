import {
  Component,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Router,
  RouterLink,
  RouterLinkActive,
} from '@angular/router';
import {
  IonContent,
  IonMenu,
  IonMenuToggle,
  IonRouterOutlet,
  IonSplitPane,
} from '@ionic/angular';
import { timeout } from 'rxjs';

interface RespuestaSesion {
  usuario: {
    id: string;
    nombre: string;
    usuario: string;
    correo: string | null;
    roles: string[];
  };
}

@Component({
  selector: 'app-principal',
  templateUrl: './principal.page.html',
  styleUrls: ['./principal.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    IonContent,
    IonMenu,
    IonMenuToggle,
    IonRouterOutlet,
    IonSplitPane,
  ],
})
export class PrincipalPage {
  private router = inject(Router);
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);

  esAdministrador = false;
  nombreUsuario = '';
  mensajeSesion = '';

  ionViewWillEnter(): void {
    this.consultarUsuario();
  }

  private consultarUsuario(): void {
    this.esAdministrador = false;
    this.nombreUsuario = '';
    this.mensajeSesion = '';

    const token = sessionStorage.getItem('token');

    if (!token) {
      this.router.navigateByUrl('/login', {
        replaceUrl: true,
      });
      return;
    }

    this.http.get<RespuestaSesion>(
      'http://localhost:3000/api/sesion',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    ).pipe(
      timeout(10000)
    ).subscribe({
      next: (respuesta) => {
        // Evita aplicar una respuesta de una sesión anterior.
        if (sessionStorage.getItem('token') !== token) {
          return;
        }

        this.nombreUsuario = respuesta.usuario.nombre;
        this.esAdministrador =
          respuesta.usuario.roles?.includes('administrador') === true;

        this.detector.markForCheck();
      },
      error: () => {
        if (sessionStorage.getItem('token') !== token) {
          return;
        }

        this.esAdministrador = false;
        this.mensajeSesion =
          'No se pudieron cargar los permisos. Recarga la página.';

        this.detector.markForCheck();
      },
    });
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('token');
    this.esAdministrador = false;
    this.nombreUsuario = '';
    this.mensajeSesion = '';

    this.router.navigateByUrl('/login', {
      replaceUrl: true,
    });
  }
}