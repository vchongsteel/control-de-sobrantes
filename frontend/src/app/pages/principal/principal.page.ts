import { Component, inject, ChangeDetectorRef, HostListener, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonContent, IonMenu, IonMenuToggle, IonRouterOutlet, IonSplitPane, IonIcon, IonMenuButton } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
import { addIcons } from 'ionicons';
import { homeOutline, cubeOutline, clipboardOutline, checkmarkCircleOutline, carOutline,
  documentTextOutline, timeOutline, peopleOutline, personOutline, logOutOutline,
  chevronDownOutline, closeOutline, settingsOutline } from 'ionicons/icons';

interface UsuarioSesion { id: string; nombre: string; usuario: string; correo: string | null; roles: string[]; }
interface RespuestaSesion { usuario: UsuarioSesion; }

@Component({
  selector: 'app-principal', templateUrl: './principal.page.html', styleUrls: ['./principal.page.scss'],
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, IonContent, IonMenu, IonMenuToggle,
    IonRouterOutlet, IonSplitPane, IonIcon, IonMenuButton],
})
export class PrincipalPage {
  private router = inject(Router);
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private consultaActual = 0;
  esAdministrador = false;
  puedeAprobar = false;
  puedeDespachar = false;
  nombreUsuario = '';
  mensajeSesion = '';
  usuarioActual: UsuarioSesion | null = null;
  menuPerfilAbierto = false;
  perfilAbierto = false;

  constructor() {
    addIcons({ homeOutline, cubeOutline, clipboardOutline, checkmarkCircleOutline, carOutline,
      documentTextOutline, timeOutline, peopleOutline, personOutline, logOutOutline,
      chevronDownOutline, closeOutline, settingsOutline });
  }
  get iniciales(): string {
    return this.nombreUsuario.trim().split(/\s+/).filter(Boolean).slice(0,2)
      .map(parte => parte.charAt(0)).join('').toUpperCase() || 'US';
  }
  get rolVisible(): string {
    const roles = this.usuarioActual?.roles || [];
    if (roles.includes('administrador')) return 'Administrador';
    if (roles.includes('supervisor')) return 'Supervisor';
    if (roles.includes('bodega')) return 'Bodega';
    if (roles.includes('colaborador')) return 'Colaborador';
    return 'Sin rol asignado';
  }
  ionViewWillEnter(): void { this.consultarUsuario(); }
  private limpiarSesion(): void {
    this.esAdministrador = false; this.puedeAprobar = false; this.puedeDespachar = false;
    this.nombreUsuario = ''; this.usuarioActual = null; this.mensajeSesion = '';
    this.menuPerfilAbierto = false; this.perfilAbierto = false;
  }
  private consultarUsuario(): void {
    const consulta = ++this.consultaActual;
    this.limpiarSesion();
    const token = sessionStorage.getItem('token');
    if (!token) { this.router.navigateByUrl('/login', { replaceUrl: true }); return; }
    this.http.get<RespuestaSesion>('http://localhost:3000/api/sesion', {
      headers: { Authorization: `Bearer ${token}` },
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: respuesta => {
        if (consulta !== this.consultaActual || sessionStorage.getItem('token') !== token) return;
        const usuario = respuesta.usuario;
        const roles = usuario.roles || [];
        this.usuarioActual = usuario; this.nombreUsuario = usuario.nombre;
        this.esAdministrador = roles.includes('administrador');
        this.puedeAprobar = roles.some(rol => ['administrador','supervisor'].includes(rol));
        this.puedeDespachar = roles.some(rol => ['administrador','supervisor','bodega'].includes(rol));
        this.detector.markForCheck();
      },
      error: () => {
        if (consulta !== this.consultaActual || sessionStorage.getItem('token') !== token) return;
        this.limpiarSesion();
        this.mensajeSesion = 'No se pudieron cargar los permisos. Recarga la página.';
        this.detector.markForCheck();
      },
    });
  }
  alternarMenuPerfil(evento: Event): void { evento.stopPropagation(); this.menuPerfilAbierto = !this.menuPerfilAbierto; }
  abrirPerfil(): void { this.menuPerfilAbierto = false; this.perfilAbierto = true; }
  cerrarPerfil(): void { this.perfilAbierto = false; }
  @HostListener('document:click', ['$event'])
  cerrarMenuAlPulsarFuera(evento: MouseEvent): void {
    const elemento = evento.target;
    if (elemento instanceof Element && elemento.closest('.cuenta')) return;
    this.menuPerfilAbierto = false;
  }
  @HostListener('document:keydown.escape')
  cerrarConEscape(): void { this.menuPerfilAbierto = false; this.perfilAbierto = false; }
  cerrarSesion(): void {
    ++this.consultaActual; sessionStorage.removeItem('token'); this.limpiarSesion();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
