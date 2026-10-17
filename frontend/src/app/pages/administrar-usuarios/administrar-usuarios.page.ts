import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { timeout, TimeoutError } from 'rxjs';

interface CuentaPendiente {
  id: string;
  nombre: string;
  usuario: string;
  correo: string | null;
}

interface CuentaVista extends CuentaPendiente {
  seleccion: Record<string, boolean>;
}

@Component({
  selector: 'app-administrar-usuarios',
  templateUrl: './administrar-usuarios.page.html',
  styleUrls: ['./administrar-usuarios.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
  ],
})
export class AdministrarUsuariosPage implements OnInit {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private api = 'http://localhost:3000/api';

  cuentas: CuentaVista[] = [];
  cargando = false;
  aprobandoId = '';
  mensaje = '';
  permitido = false;

  roles = [
    { valor: 'colaborador', nombre: 'Colaborador' },
    { valor: 'bodega', nombre: 'Encargado de bodega' },
    { valor: 'supervisor', nombre: 'Supervisor' },
    { valor: 'administrador', nombre: 'Administrador' },
  ];

  ngOnInit(): void {
    this.comprobarAcceso();
  }

  private get headers() {
    return {
      Authorization: `Bearer ${sessionStorage.getItem('token') || ''}`,
    };
  }

  private comprobarAcceso(): void {
    this.cargando = true;

    this.http.get<{
      usuario: { roles: string[] };
    }>(
      `${this.api}/sesion`,
      { headers: this.headers }
    ).pipe(
      timeout(10000)
    ).subscribe({
      next: (respuesta) => {
        this.permitido =
          respuesta.usuario.roles.includes('administrador');

        this.cargando = false;

        if (this.permitido) {
          this.cargarPendientes();
        } else {
          this.mensaje =
            'Esta pantalla está disponible solo para administradores.';
        }

        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;
        this.mensaje = this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }

  cargarPendientes(): void {
    if (!this.permitido || this.cargando || this.aprobandoId) {
      return;
    }

    this.cargando = true;
    this.mensaje = '';

    this.http.get<{ usuarios: CuentaPendiente[] }>(
      `${this.api}/admin/usuarios/pendientes`,
      { headers: this.headers }
    ).pipe(
      timeout(10000)
    ).subscribe({
      next: (respuesta) => {
        this.cuentas = respuesta.usuarios.map((cuenta) => ({
          ...cuenta,
          seleccion: {
            colaborador: true,
            bodega: false,
            supervisor: false,
            administrador: false,
          },
        }));

        this.cargando = false;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;
        this.mensaje = this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }

  aprobar(cuenta: CuentaVista): void {
    if (!this.permitido || this.cargando || this.aprobandoId) {
      return;
    }

    const rolesElegidos = this.roles
      .filter((rol) => cuenta.seleccion[rol.valor])
      .map((rol) => rol.valor);

    if (!rolesElegidos.length) {
      this.mensaje = 'Selecciona al menos un rol para esta cuenta.';
      return;
    }

    this.aprobandoId = cuenta.id;
    this.mensaje = '';

    this.http.post<{ mensaje: string }>(
      `${this.api}/admin/usuarios/${cuenta.id}/aprobar`,
      { roles: rolesElegidos },
      { headers: this.headers }
    ).pipe(
      timeout(15000)
    ).subscribe({
      next: (respuesta) => {
        this.cuentas = this.cuentas.filter(
          (item) => item.id !== cuenta.id
        );

        this.aprobandoId = '';
        this.mensaje = `${cuenta.nombre}: ${respuesta.mensaje}`;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.aprobandoId = '';

        this.mensaje = error instanceof TimeoutError
          ? 'No llegó la confirmación. Pulsa Actualizar lista para comprobar si la cuenta fue aprobada.'
          : this.describirError(error);

        this.detector.markForCheck();
      },
    });
  }

  private describirError(error: unknown): string {
    if (error instanceof TimeoutError) {
      return 'El servidor tardó demasiado en responder.';
    }

    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'No se pudo conectar con el servidor.';
      }

      return error.error?.mensaje ||
        'No se pudo completar la operación.';
    }

    return 'Ocurrió un error inesperado.';
  }
}