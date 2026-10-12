import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar } from '@ionic/angular';
import { Subscription, catchError, filter, from, map, mergeMap, of, timeout } from 'rxjs';

interface Sobrante {
  id: string;
  codigo_lote: string;
  codigo: string;
  descripcion: string;
  familia: string;
  tipo: string;
  cantidad: string;
  unidad: string;
  ubicacion: string;
  observaciones: string;
  foto_nombre: string | null;
  creado_en: string;
  registrado_por: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  revisado_en: string | null;
  revisado_por: string | null;
  motivo_rechazo: string | null;
}

@Component({
  selector: 'app-sobrantes',
  templateUrl: './sobrantes.page.html',
  styleUrls: ['./sobrantes.page.scss'],
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, IonButtons,
    IonContent, IonHeader, IonMenuButton, IonTitle, IonToolbar],
})
export class SobrantesPage implements OnDestroy {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private api = 'http://localhost:3000/api/sobrantes';
  private peticionLista?: Subscription;
  private peticionFotos?: Subscription;
  @ViewChild('panelDetalle') panelDetalle?: ElementRef<HTMLElement>;

  sobrantes: Sobrante[] = [];
  fotos: Record<string, string> = {};
  fotosFallidas: Record<string, boolean> = {};
  cargando = false;
  error = '';
  mensaje = '';
  filtroEstado = '';
  puedeRevisar = false;
  revisando = false;
  seleccionado: Sobrante | null = null;
  motivo = '';

  ionViewWillEnter(): void { this.cargarSobrantes(); }
  private encabezados(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${sessionStorage.getItem('token') || ''}` });
  }
  cambiarFiltro(): void {
    this.mensaje = '';
    this.cargarSobrantes();
  }
  cargarSobrantes(): void {
    this.peticionLista?.unsubscribe();
    this.liberarFotos();
    this.seleccionado = null;
    this.motivo = '';
    this.cargando = true;
    this.error = '';
    this.sobrantes = [];
    this.detector.markForCheck();
    let params = new HttpParams();
    if (this.filtroEstado) params = params.set('estado', this.filtroEstado);
    this.peticionLista = this.http.get<{ sobrantes: Sobrante[]; puede_revisar: boolean }>(
      this.api, { headers: this.encabezados(), params }
    ).pipe(timeout(10000)).subscribe({
      next: (respuesta) => {
        this.sobrantes = respuesta.sobrantes;
        this.puedeRevisar = respuesta.puede_revisar;
        this.cargando = false;
        this.cargarFotos();
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.cargando = false;
        this.puedeRevisar = false;
        this.error = this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }
  private cargarFotos(): void {
    // Las fotos se consultan con el token. Se cargan hasta cuatro a la vez.
    this.peticionFotos = from(this.sobrantes).pipe(
      filter((sobrante) => !!sobrante.foto_nombre),
      mergeMap((sobrante) => this.http.get(
        `${this.api}/${encodeURIComponent(sobrante.id)}/foto`,
        { headers: this.encabezados(), responseType: 'blob' }
      ).pipe(
        timeout(10000),
        map((archivo) => ({ id: sobrante.id, archivo })),
        catchError(() => of({ id: sobrante.id, archivo: null }))
      ), 4)
    ).subscribe((resultado) => {
      if (resultado.archivo) {
        this.fotos[resultado.id] = URL.createObjectURL(resultado.archivo);
      } else {
        this.fotosFallidas[resultado.id] = true;
      }
      this.detector.markForCheck();
    });
  }
  abrirDetalle(sobrante: Sobrante): void {
    if (this.revisando) return;
    this.seleccionado = sobrante;
    this.motivo = '';
    this.error = '';
    this.detector.detectChanges();
    this.panelDetalle?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.panelDetalle?.nativeElement.focus({ preventScroll: true });
  }
  cerrarDetalle(): void {
    if (this.revisando) return;
    this.seleccionado = null;
    this.motivo = '';
  }
  revisar(estado: 'aprobado' | 'rechazado'): void {
    const sobrante = this.seleccionado;
    if (!sobrante || this.revisando || !this.puedeRevisar || sobrante.estado !== 'pendiente') return;
    const motivo = this.motivo.trim();
    this.error = '';
    this.mensaje = '';
    if (estado === 'rechazado' && !motivo) {
      this.error = 'Escribe el motivo para rechazar el sobrante.';
      return;
    }
    this.revisando = true;
    this.http.patch<{ mensaje: string }>(
      `${this.api}/${encodeURIComponent(sobrante.id)}/revision`,
      { estado, motivo }, { headers: this.encabezados() }
    ).subscribe({
      next: (respuesta) => {
        this.revisando = false;
        this.mensaje = respuesta.mensaje;
        this.cargarSobrantes();
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.revisando = false;
        this.error = this.describirError(error) + ' Actualiza la lista para comprobar su estado.';
        this.detector.markForCheck();
      },
    });
  }
  private describirError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) return 'La sesión venció. Inicia sesión nuevamente.';
      if (error.status === 0) return 'No se pudo conectar con el backend.';
      if (typeof error.error?.mensaje === 'string') return error.error.mensaje;
      if (error.status === 403) return 'No tienes permiso para esta acción.';
    }
    return 'No se pudo completar la operación.';
  }
  private liberarFotos(): void {
    this.peticionFotos?.unsubscribe();
    Object.values(this.fotos).forEach((url) => URL.revokeObjectURL(url));
    this.fotos = {};
    this.fotosFallidas = {};
  }
  ionViewWillLeave(): void {
    this.peticionLista?.unsubscribe();
    this.liberarFotos();
  }
  ngOnDestroy(): void {
    this.peticionLista?.unsubscribe();
    this.liberarFotos();
  }
}