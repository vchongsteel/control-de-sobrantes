import { Component, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonContent, IonMenu, IonMenuToggle, IonRouterOutlet, IonSplitPane,
  IonIcon, IonMenuButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline, cubeOutline, clipboardOutline, carOutline,
  documentTextOutline, checkmarkCircleOutline, timeOutline,
  peopleOutline, personOutline, logOutOutline, chevronDownOutline,
  closeOutline,
} from 'ionicons/icons';
import { timeout } from 'rxjs';

interface UsuarioSesion {
  id: string;
  nombre: string;
  usuario: string;
  correo: string | null;
  roles: string[];
}
interface RespuestaSesion { usuario: UsuarioSesion; }

@Component({
  selector: 'app-principal',
  templateUrl: './principal.page.html',
  styleUrls: ['./principal.page.scss'],
  standalone: true,
  imports: [
    CommonModule, RouterLink, RouterLinkActive, IonContent, IonMenu,
    IonMenuToggle, IonRouterOutlet, IonSplitPane, IonIcon, IonMenuButton,
  ],
})
export class PrincipalPage {
  private router = inject(Router);
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);

  puedeAprobar = false;
  esAdministrador = false;
  nombreUsuario = '';
  mensajeSesion = '';
  usuarioActual: UsuarioSesion | null = null;
  menuPerfilAbierto = false;
  perfilAbierto = false;

  constructor() {
    addIcons({
      homeOutline, cubeOutline, clipboardOutline, carOutline,
      documentTextOutline, checkmarkCircleOutline, timeOutline,
      peopleOutline, personOutline, logOutOutline, chevronDownOutline,
      closeOutline,
    });
  }

  get iniciales(): string {
    const partes = this.nombreUsuario.trim().split(/\s+/).filter(Boolean);
    return partes.length ? partes.slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase() : 'U';
  }

  get rolVisible(): string {
    const roles = this.usuarioActual?.roles || [];
    if (roles.includes('administrador')) return 'Administrador';
    if (roles.includes('supervisor')) return 'Supervisor';
    const rol = roles[0];
    return rol ? rol.charAt(0).toUpperCase() + rol.slice(1) : 'Usuario';
  }

  ionViewWillEnter(): void {
    this.menuPerfilAbierto = false;
    this.perfilAbierto = false;
    this.consultarUsuario();
  }

  alternarMenuPerfil(evento: Event): void {
    evento.stopPropagation();
    this.menuPerfilAbierto = !this.menuPerfilAbierto;
  }

  abrirPerfil(): void {
    this.menuPerfilAbierto = false;
    this.perfilAbierto = true;
  }

  cerrarPerfil(): void { this.perfilAbierto = false; }

  @HostListener('document:click')
  cerrarMenuPerfil(): void { this.menuPerfilAbierto = false; }

  @HostListener('document:keydown.escape')
  cerrarPaneles(): void {
    this.menuPerfilAbierto = false;
    this.perfilAbierto = false;
  }

  private consultarUsuario(): void {
    this.puedeAprobar = false;
    this.esAdministrador = false;
    this.nombreUsuario = '';
    this.usuarioActual = null;
    this.mensajeSesion = '';
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    this.http.get<RespuestaSesion>('http://localhost:3000/api/sesion', {
      headers: { Authorization: `Bearer ${token}` },
    }).pipe(timeout(10000)).subscribe({
      next: (respuesta) => {
        if (sessionStorage.getItem('token') !== token) return;
        this.usuarioActual = respuesta.usuario;
        this.nombreUsuario = respuesta.usuario.nombre;
        this.puedeAprobar = respuesta.usuario.roles.some(r => ['administrador', 'supervisor'].includes(r));
        this.esAdministrador = respuesta.usuario.roles?.includes('administrador') === true;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        if (sessionStorage.getItem('token') !== token) return;
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.cerrarSesion();
          return;
        }
        this.puedeAprobar = false;
    this.esAdministrador = false;
        this.mensajeSesion = 'No se pudieron cargar los permisos. Recarga la página.';
        this.detector.markForCheck();
      },
    });
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('token');
    this.puedeAprobar = false;
    this.esAdministrador = false;
    this.nombreUsuario = '';
    this.usuarioActual = null;
    this.mensajeSesion = '';
    this.menuPerfilAbierto = false;
    this.perfilAbierto = false;
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
