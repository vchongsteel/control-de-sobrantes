import { Component, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonContent } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
interface Solicitud { id: string; codigo: string; solicitante: string; proyecto: string; creado_en: string; estado?: string; observaciones?: string; }
interface Linea { sobrante_id: string; codigo_lote: string; codigo: string; descripcion: string; cantidad: string; unidad: string; ubicacion: string; }
@Component({ selector: 'app-aprobaciones', standalone: true, imports: [CommonModule, IonContent], templateUrl: './aprobaciones.page.html', styleUrls: ['./aprobaciones.page.scss'] })
export class AprobacionesPage {
  private http = inject(HttpClient); private detector = inject(ChangeDetectorRef); private destroy = inject(DestroyRef);
  private api = 'http://localhost:3000/api/solicitudes';
  solicitudes: Solicitud[] = []; seleccion: Solicitud | null = null; detalles: Linea[] = [];
  pagina = 1; total = 0; cargando = false; cargandoDetalle = false; aprobando = false; error = ''; mensaje = '';
  private secuencia = 0;
  get headers(): HttpHeaders { return new HttpHeaders({ Authorization: `Bearer ${sessionStorage.getItem('token') || ''}` }); }
  get paginas(): number { return Math.max(1, Math.ceil(this.total / 20)); }
  ionViewWillEnter(): void { this.cargar(); }
  cargar(): void {
    if (this.aprobando) return;
    this.cargando = true; this.error = ''; this.seleccion = null; this.detalles = []; ++this.secuencia; this.cargandoDetalle = false;
    this.http.get<{ solicitudes: Solicitud[]; total: number }>(`${this.api}/aprobaciones?pagina=${this.pagina}`, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroy)).subscribe({
        next: r => { this.solicitudes = r.solicitudes; this.total = r.total; this.cargando = false; this.detector.markForCheck(); },
        error: e => { this.solicitudes = []; this.error = e.error?.mensaje || 'No se pudieron cargar las solicitudes.'; this.cargando = false; this.detector.markForCheck(); }
      });
  }
  cambiar(delta: number): void { this.pagina += delta; this.cargar(); }
  ver(s: Solicitud): void {
    if (this.aprobando) return;
    const secuencia = ++this.secuencia;
    this.seleccion = null; this.detalles = []; this.cargandoDetalle = true; this.error = ''; this.mensaje = '';
    this.http.get<{ solicitud: Solicitud; detalles: Linea[] }>(`${this.api}/${s.id}`, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroy)).subscribe({
        next: r => { if (secuencia !== this.secuencia) return; this.seleccion = r.solicitud; this.detalles = r.detalles; this.cargandoDetalle = false; this.detector.markForCheck(); },
        error: e => { if (secuencia !== this.secuencia) return; this.error = e.error?.mensaje || 'No se pudo cargar el detalle.'; this.cargandoDetalle = false; this.detector.markForCheck(); }
      });
  }
  aprobar(): void {
    if (!this.seleccion || this.aprobando || this.seleccion.estado !== 'enviada') return;
    if (!window.confirm(`¿Aprobar la solicitud ${this.seleccion.codigo}?`)) return;
    this.aprobando = true; this.error = ''; this.mensaje = '';
    this.http.patch<{ mensaje: string }>(`${this.api}/${this.seleccion.id}/aprobar`, {}, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroy)).subscribe({
        next: r => { this.aprobando = false; this.mensaje = r.mensaje; this.cargar(); this.detector.markForCheck(); },
        error: e => { this.aprobando = false; this.error = e.error?.mensaje || 'No se confirmó la aprobación. Actualiza para comprobar su estado.'; this.detector.markForCheck(); }
      });
  }
}
