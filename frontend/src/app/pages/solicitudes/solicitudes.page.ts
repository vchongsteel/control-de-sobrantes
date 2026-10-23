import { Component, ChangeDetectorRef, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { IonContent } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';

interface Lote {
  id: string; codigo_lote: string; codigo: string; descripcion: string;
  familia: string; tipo: string; disponible: string | number; unidad: string;
  ubicacion: string; foto_nombre: string | null;
}
interface Linea extends Lote { cantidad: number; }
interface Opcion { familia_id: number; familia: string; tipo: string; }
interface Solicitud {
  id: string; codigo: string; solicitado_por: string; solicitante: string;
  proyecto: string; observaciones: string; estado: 'enviada' | 'aprobada' | 'cancelada';
  creado_en: string; lotes: number;
}
interface Detalle { sobrante_id: string; codigo: string; codigo_lote: string;
  descripcion: string; ubicacion: string; cantidad: string; unidad: string; }
interface Envio { clave_envio: string; proyecto: string; observaciones: string;
  articulos: { sobrante_id: string; cantidad: string }[]; }

@Component({
  selector: 'app-solicitudes', standalone: true,
  templateUrl: './solicitudes.page.html', styleUrls: ['./solicitudes.page.scss'],
  imports: [CommonModule, FormsModule, IonContent],
})
export class SolicitudesPage implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private api = 'http://localhost:3000/api';
  private secuencia = 0;
  private fotosEnCurso = new Set<string>();
  private fotosSolicitadas = new Set<string>();
  private solicitudDetalleSecuencia = 0;
  tab: 'catalogo' | 'solicitudes' = 'catalogo';
  buscar = ''; familia = ''; tipo = ''; pagina = 1; total = 0;
  opciones: Opcion[] = []; lotes: Lote[] = []; carrito: Linea[] = [];
  cantidades: Record<string, number> = {}; fotos: Record<string, string> = {};
  proyecto = ''; observaciones = ''; cargando = false; enviando = false;
  error = ''; errorCatalogo = ''; errorFiltros = ''; mensaje = ''; carritoAbierto = false;
  usuarioId = ''; esAdministrador = false; puedeVerTodas = false;
  solicitudes: Solicitud[] = []; paginaSolicitudes = 1; totalSolicitudes = 0;
  cargandoSolicitudes = false; errorSolicitudes = ''; cancelando = false;
  solicitudDetalle: Solicitud | null = null; detalles: Detalle[] = [];
  cargandoDetalle = false; errorDetalle = '';
  pendiente: Envio | null = null;
  get headers(): HttpHeaders { return new HttpHeaders({ Authorization: `Bearer ${sessionStorage.getItem('token') || ''}` }); }
  get familias(): { id: string; nombre: string }[] {
    return Array.from(new Map(this.opciones.map(o => [String(o.familia_id), { id: String(o.familia_id), nombre: o.familia }])).values());
  }
  get tipos(): string[] {
    return Array.from(new Set(this.opciones.filter(o => !this.familia || String(o.familia_id) === this.familia).map(o => o.tipo).filter(Boolean)));
  }
  get paginas(): number { return Math.max(1, Math.ceil(this.total / 12)); }
  get paginasSolicitudes(): number { return Math.max(1, Math.ceil(this.totalSolicitudes / 20)); }
  get bloqueado(): boolean { return this.enviando || !!this.pendiente; }

  ngOnInit(): void {
    this.cargarFiltros(); this.cargarCatalogo();
    this.http.get<{ usuario: { id: string; roles: string[] } }>(`${this.api}/sesion`, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => {
          this.usuarioId = r.usuario.id;
          this.esAdministrador = r.usuario.roles.includes('administrador');
          this.recuperarPendiente(); this.cargarSolicitudes(); this.detector.markForCheck();
        },
        error: () => { this.error = 'No se pudo comprobar tu sesión. Recarga la página antes de enviar.'; this.detector.markForCheck(); },
      });
  }
  ngOnDestroy(): void { Object.values(this.fotos).forEach(url => URL.revokeObjectURL(url)); }
  nombreUnidad(unidad: string): string {
    return ({ unidades: 'unidades', kg: 'kg', m: 'm', m2: 'm²', m3: 'm³', litros: 'litros' } as Record<string, string>)[unidad] || unidad;
  }
  cargarFiltros(): void {
    this.errorFiltros = '';
    this.http.get<{ opciones: Opcion[] }>(`${this.api}/solicitudes/filtros`, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => { this.opciones = r.opciones; this.detector.markForCheck(); },
        error: () => { this.errorFiltros = 'No se pudieron cargar las familias y tipos.'; this.detector.markForCheck(); },
      });
  }
  cambiarFamilia(): void { this.tipo = ''; this.cargarCatalogo(1); }
  limpiarFiltros(): void { this.buscar = ''; this.familia = ''; this.tipo = ''; this.cargarCatalogo(1); }
  cargarCatalogo(pagina = 1): void {
    this.pagina = pagina; this.cargando = true; this.errorCatalogo = '';
    const secuencia = ++this.secuencia;
    const params = new HttpParams().set('q', this.buscar.trim()).set('familia', this.familia)
      .set('tipo', this.tipo).set('pagina', pagina);
    this.http.get<{ sobrantes: Lote[]; total: number }>(`${this.api}/solicitudes/disponibles`, { headers: this.headers, params })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => {
          if (secuencia !== this.secuencia) return;
          this.lotes = r.sobrantes; this.total = r.total; this.cargando = false;
          for (const lote of this.lotes) {
            this.cantidades[lote.id] = this.cantidades[lote.id] || Math.min(1, Number(lote.disponible));
            if (lote.foto_nombre) this.cargarFoto(lote.id);
          }
          this.detector.markForCheck();
        },
        error: e => {
          if (secuencia !== this.secuencia) return;
          this.cargando = false; this.errorCatalogo = this.textoError(e, 'No se pudo cargar el catálogo.');
          this.lotes = []; this.detector.markForCheck();
        },
      });
  }
  private cargarFoto(id: string): void {
    if (this.fotos[id] || this.fotosEnCurso.has(id) || this.fotosSolicitadas.has(id)) return;
    this.fotosEnCurso.add(id); this.fotosSolicitadas.add(id);
    this.http.get(`${this.api}/sobrantes/${id}/foto`, { headers: this.headers, responseType: 'blob' })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: blob => { this.fotos[id] = URL.createObjectURL(blob); this.fotosEnCurso.delete(id); this.detector.markForCheck(); },
        error: () => { this.fotosEnCurso.delete(id); this.detector.markForCheck(); },
      });
  }
  sumarCantidad(lote: Lote, cambio: number): void {
    const max = Number(lote.disponible);
    this.cantidades[lote.id] = Math.round(Math.min(max, Math.max(0.001, (Number(this.cantidades[lote.id]) || 0) + cambio)) * 1000) / 1000;
  }
  agregar(lote: Lote): void {
    if (this.bloqueado) return;
    this.error = ''; this.mensaje = '';
    const cantidad = Number(this.cantidades[lote.id]);
    const existente = this.carrito.find(l => l.id === lote.id);
    const suma = Math.round((cantidad + (existente?.cantidad || 0)) * 1000) / 1000;
    if (!this.cantidadValida(cantidad) || suma > Number(lote.disponible)) {
      this.error = 'Revisa la cantidad: debe ser positiva, con hasta tres decimales, y no superar lo disponible incluyendo tu carrito.'; return;
    }
    if (!existente && this.carrito.length >= 50) { this.error = 'Puedes agregar hasta 50 lotes por solicitud.'; return; }
    if (existente) { existente.cantidad = suma; existente.disponible = lote.disponible; }
    else this.carrito.push({ ...lote, cantidad });
    this.mensaje = `${lote.codigo_lote} agregado a tu solicitud.`;
  }
  quitar(id: string): void { if (!this.bloqueado) this.carrito = this.carrito.filter(l => l.id !== id); }
  cambiarCantidad(linea: Linea, cambio: number): void {
    if (this.bloqueado) return;
    linea.cantidad = Math.round(Math.min(Number(linea.disponible), Math.max(0.001, Number(linea.cantidad || 0) + cambio)) * 1000) / 1000;
  }
  private cantidadValida(cantidad: unknown): boolean {
    return /^\d{1,12}(\.\d{1,3})?$/.test(String(cantidad)) && Number(cantidad) >= 0.001;
  }
  enviar(): void {
    if (this.enviando || !this.usuarioId) return;
    this.error = ''; this.mensaje = '';
    if (!this.pendiente) {
      if (!this.carrito.length || this.carrito.some(l => !this.cantidadValida(l.cantidad) || Number(l.cantidad) > Number(l.disponible))) {
        this.error = 'Agrega materiales y revisa las cantidades del carrito.'; return;
      }
      this.pendiente = { clave_envio: crypto.randomUUID(), proyecto: this.proyecto.trim(), observaciones: this.observaciones.trim(),
        articulos: this.carrito.map(l => ({ sobrante_id: l.id, cantidad: String(l.cantidad) })) };
      try { sessionStorage.setItem(`solicitud-pendiente:${this.usuarioId}`, JSON.stringify({ envio: this.pendiente, carrito: this.carrito })); }
      catch { this.pendiente = null; this.error = 'No se pudo guardar el envío para recuperarlo. Revisa el almacenamiento del navegador.'; return; }
    }
    this.enviando = true;
    this.http.post<{ id: string; codigo: string; mensaje: string }>(`${this.api}/solicitudes`, this.pendiente, { headers: this.headers })
      .pipe(timeout(20000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => {
          this.enviando = false; this.limpiarPendiente(); this.carrito = [];
          this.proyecto = ''; this.observaciones = ''; this.carritoAbierto = false;
          this.mensaje = `${r.codigo}: ${r.mensaje}`;
          this.cargarCatalogo(1); this.cargarFiltros(); this.cargarSolicitudes(1); this.detector.markForCheck();
        },
        error: (e: unknown) => {
          this.enviando = false;
          if (e instanceof HttpErrorResponse && [400, 403, 409].includes(e.status)) this.limpiarPendiente();
          this.error = this.textoError(e, 'No se confirmó el envío. Usa Reintentar envío para comprobarlo sin duplicar la solicitud.');
          if (e instanceof HttpErrorResponse && e.status === 409) this.cargarCatalogo(1);
          this.detector.markForCheck();
        },
      });
  }
  private limpiarPendiente(): void {
    this.pendiente = null;
    try { sessionStorage.removeItem(`solicitud-pendiente:${this.usuarioId}`); } catch { /* Sin almacenamiento disponible. */ }
  }
  private recuperarPendiente(): void {
    try {
      const valor = sessionStorage.getItem(`solicitud-pendiente:${this.usuarioId}`);
      if (!valor) return;
      const datos = JSON.parse(valor);
      if (!datos.envio?.clave_envio || !Array.isArray(datos.carrito)) return;
      this.pendiente = datos.envio; this.carrito = datos.carrito;
      this.proyecto = datos.envio.proyecto; this.observaciones = datos.envio.observaciones;
      this.carritoAbierto = true;
      this.mensaje = 'Hay un envío pendiente de confirmación. Reinténtalo para recuperar su resultado.';
    } catch { this.error = 'No se pudo recuperar el envío pendiente de este navegador.'; }
  }
  cargarSolicitudes(pagina = 1): void {
    if (this.cargandoSolicitudes) return;
    this.paginaSolicitudes = pagina; this.cargandoSolicitudes = true; this.errorSolicitudes = '';
    this.http.get<{ solicitudes: Solicitud[]; total: number; puede_ver_todas: boolean }>(`${this.api}/solicitudes`, {
      headers: this.headers, params: new HttpParams().set('pagina', pagina),
    }).pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { this.solicitudes = r.solicitudes; this.totalSolicitudes = r.total; this.puedeVerTodas = r.puede_ver_todas;
        this.cargandoSolicitudes = false; this.detector.markForCheck(); },
      error: e => { this.cargandoSolicitudes = false; this.errorSolicitudes = this.textoError(e, 'No se pudieron consultar las solicitudes.'); this.detector.markForCheck(); },
    });
  }
  verDetalle(solicitud: Solicitud): void {
    this.solicitudDetalle = solicitud; this.detalles = []; this.cargandoDetalle = true; this.errorDetalle = '';
    const secuencia = ++this.solicitudDetalleSecuencia;
    this.http.get<{ solicitud: Solicitud; detalles: Detalle[] }>(`${this.api}/solicitudes/${solicitud.id}`, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => { if (secuencia !== this.solicitudDetalleSecuencia) return;
          this.solicitudDetalle = r.solicitud; this.detalles = r.detalles; this.cargandoDetalle = false; this.detector.markForCheck(); },
        error: e => { if (secuencia !== this.solicitudDetalleSecuencia) return;
          this.cargandoDetalle = false; this.errorDetalle = this.textoError(e, 'No se pudo consultar el detalle.'); this.detector.markForCheck(); },
      });
  }
  puedeCancelar(s: Solicitud): boolean { return s.estado === 'enviada' && (s.solicitado_por === this.usuarioId || this.esAdministrador); }
  cancelar(s: Solicitud): void {
    if (this.cancelando || !this.puedeCancelar(s) || !window.confirm(`¿Cancelar ${s.codigo} y liberar sus materiales?`)) return;
    this.cancelando = true; this.errorSolicitudes = '';
    this.http.patch<{ mensaje: string }>(`${this.api}/solicitudes/${s.id}/cancelar`, {}, { headers: this.headers })
      .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: r => { this.cancelando = false; this.mensaje = r.mensaje;
          if (this.solicitudDetalle?.id === s.id) this.solicitudDetalle = null;
          this.cargarSolicitudes(this.paginaSolicitudes); this.cargarCatalogo(1); this.cargarFiltros(); this.detector.markForCheck(); },
        error: e => { this.cancelando = false; this.errorSolicitudes = this.textoError(e, 'No se confirmó la cancelación. Actualiza la lista.'); this.detector.markForCheck(); },
      });
  }
  private textoError(e: unknown, defecto: string): string {
    return e instanceof HttpErrorResponse && typeof e.error?.mensaje === 'string' ? e.error.mensaje : defecto;
  }
}
