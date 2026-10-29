import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
import { TemaService } from '../../services/tema.service';

interface Usuario { nombre: string; usuario: string; correo: string | null; roles: string[]; }

@Component({
  selector: 'app-configuracion',
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
  standalone: true,
  imports: [IonContent, RouterLink],
})
export class ConfiguracionPage {
  readonly tema = inject(TemaService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private consulta = 0;
  readonly usuario = signal<Usuario | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');

  ionViewWillEnter(): void { this.cargarUsuario(); }

  cargarUsuario(): void {
    const token = sessionStorage.getItem('token');
    const consulta = ++this.consulta;
    this.usuario.set(null);
    this.error.set('');
    if (!token) { this.router.navigateByUrl('/login', { replaceUrl: true }); return; }
    this.cargando.set(true);
    this.http.get<{ usuario: Usuario }>('http://localhost:3000/api/sesion', {
      headers: { Authorization: `Bearer ${token}` },
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: respuesta => {
        if (consulta !== this.consulta || sessionStorage.getItem('token') !== token) return;
        this.usuario.set(respuesta.usuario);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        if (consulta !== this.consulta || sessionStorage.getItem('token') !== token) return;
        this.cargando.set(false);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          sessionStorage.removeItem('token');
          this.router.navigateByUrl('/login', { replaceUrl: true });
          return;
        }
        this.error.set('No se pudieron cargar los datos de tu cuenta.');
      },
    });
  }
}
