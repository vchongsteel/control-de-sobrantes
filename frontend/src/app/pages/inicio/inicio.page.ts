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
  material_id: number | null;
  descripcion_manual: string | null;
  version_datos: number;
  codigo: string;
  descripcion: string;
  familia: string;
  tipo: string;
  cantidad: string;
  unidad: string;
  ubicacion: string;
  ubicacion_id: number | null;
  articulo_completo: number | null;
  observaciones: string;
  foto_nombre: string | null;
  creado_en: string;
  registrado_por: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  revisado_en: string | null;
  revisado_por: string | null;
  motivo_rechazo: string | null;
}
interface MaterialCatalogo {
  id: number;
  codigo: string;
  descripcion: string;
  familia: string;
  tipo: string;
}
interface Ubicacion { id: number; codigo: string; nombre: string; temporal: number; zona: string; ubicacion: string; }
interface Edicion {
  materialId: number | null;
  descripcionManual: string;
  cantidad: number | null;
  unidad: string;
  ubicacion: string;
  ubicacionId: number | null;
  articuloCompleto: number | null;
  observaciones: string;
}
@Component({
  selector: 'app-inicio',
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    IonButtons,
    IonContent,
    IonHeader,
    IonMenuButton,
    IonTitle,
    IonToolbar,
  ],
})
export class InicioPage implements OnDestroy {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private api = 'http://localhost:3000/api/sobrantes';
  private apiCatalogo = 'http://localhost:3000/api/catalogo/materiales';
  private peticionUbicaciones?: Subscription;
  private peticionUnidades?: Subscription;
  ubicaciones: Ubicacion[] = [];
  zonaEdicion = '';
  get zonas(): string[] {
    return [...new Set(this.ubicaciones.map((l) => l.zona))];
  }
  get ubicacionesZona(): Ubicacion[] {
    return this.ubicaciones.filter((l) => l.zona === this.zonaEdicion);
  }
  cambiarZonaEdicion(): void {
    if (this.edicion) this.edicion.ubicacionId = null;
  }
  private sincronizarZona(): void {
    this.zonaEdicion = this.ubicaciones.find((l) => l.id === this.edicion?.ubicacionId)?.zona || '';
  }
  unidadesPermitidas: string[] = [];
  cargandoUnidades = false;
  errorUnidades = '';
  errorUbicaciones = '';
  nombreUnidad(unidad: string): string {
    return ({ unidades: 'Unidades', kg: 'Kilogramos', m: 'Metros', m2: 'Metros cuadrados', m3: 'Metros cúbicos', litros: 'Litros' } as Record<string, string>)[unidad] || unidad;
  }
  cargarUbicaciones(): void {
    this.peticionUbicaciones?.unsubscribe();
    this.errorUbicaciones = '';
    this.peticionUbicaciones = this.http.get<{ ubicaciones: Ubicacion[] }>(
      'http://localhost:3000/api/ubicaciones', { headers: this.encabezados() }
    ).pipe(timeout(10000)).subscribe({
      next: (r) => { this.ubicaciones = r.ubicaciones; this.sincronizarZona(); this.detector.markForCheck(); },
      error: (e: unknown) => { this.errorUbicaciones = this.describirError(e); this.detector.markForCheck(); },
    });
  }
  cargarUnidadesEdicion(): void {
    this.peticionUnidades?.unsubscribe();
    this.cargandoUnidades = false;
    this.errorUnidades = '';
    this.unidadesPermitidas = [];
    const datos = this.edicion;
    if (!datos) return;
    if (!datos.materialId) {
      this.unidadesPermitidas = ['unidades', 'kg', 'm', 'm2', 'm3', 'litros'];
      return;
    }
    this.cargandoUnidades = true;
    this.peticionUnidades = this.http.get<{ unidades: string[] }>(
      `${this.apiCatalogo}/${datos.materialId}/unidades`, { headers: this.encabezados() }
    ).pipe(timeout(10000)).subscribe({
      next: (r) => {
        this.unidadesPermitidas = r.unidades;
        this.cargandoUnidades = false;
        if (!r.unidades.length) this.errorUnidades = 'El material no tiene unidades configuradas.';
        this.detector.markForCheck();
      },
      error: (e: unknown) => { this.cargandoUnidades = false; this.errorUnidades = this.describirError(e); this.detector.markForCheck(); },
    });
  }
  private peticionLista?: Subscription;
  private peticionFotos?: Subscription;
  private peticionBusqueda?: Subscription;
  private firmaOriginal = '';
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
  guardandoCambios = false;
  eliminandoId: string | null = null;
  seleccionado: Sobrante | null = null;
  edicion: Edicion | null = null;
  materialElegido: MaterialCatalogo | null = null;
  motivo = '';
  errorDetalle = '';
  mensajeDetalle = '';
  conflicto = false;
  buscar = '';
  resultados: MaterialCatalogo[] = [];
  buscando = false;
  busquedaRealizada = false;
  errorBusqueda = '';
  paginaBusqueda = 1;
  totalBusqueda = 0;
  totalPaginasBusqueda = 0;
  get ocupado(): boolean {
    return this.revisando ||
      this.guardandoCambios ||
      this.eliminandoId !== null;
  }
  get editable(): boolean {
    return this.puedeRevisar && this.seleccionado?.estado === 'pendiente';
  }
  get hayCambios(): boolean {
    return !!this.edicion && this.firma(this.edicion) !== this.firmaOriginal;
  }
  private firma(datos: Edicion): string {
    return JSON.stringify([
      datos.materialId,
      datos.materialId ? '' : datos.descripcionManual.trim(),
      datos.cantidad,
      datos.unidad,
      datos.ubicacionId,
      datos.articuloCompleto,
      datos.observaciones.trim(),
    ]);
  }
  revisarPendientes(): void {
    if (this.cargando || this.ocupado) return;
    if (this.hayCambios && !this.conflicto) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de consultar pendientes.';
      return;
    }
    this.filtroEstado = 'pendiente';
    this.cambiarFiltro();
  }
  ionViewWillEnter(): void {
    this.cargarUbicaciones();
    if (!this.ocupado) this.cargarSobrantes();
  }
  private encabezados(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${sessionStorage.getItem('token') || ''}`,
    });
  }
  cambiarFiltro(): void {
    this.mensaje = '';
    this.cargarSobrantes();
  }
  cargarSobrantes(): void {
    if (this.ocupado) return;
    if (this.hayCambios && !this.conflicto) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de actualizar la lista.';
      return;
    }
    this.peticionLista?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
    this.cancelarBusqueda();
    this.liberarFotos();
    this.seleccionado = null;
    this.edicion = null;
    this.materialElegido = null;
    this.motivo = '';
    this.conflicto = false;
    this.errorDetalle = '';
    this.mensajeDetalle = '';
    this.cargando = true;
    this.error = '';
    this.sobrantes = [];
    this.detector.markForCheck();
    let params = new HttpParams();
    if (this.filtroEstado) {
      params = params.set('estado', this.filtroEstado);
    }
    this.peticionLista = this.http.get<{
      sobrantes: Sobrante[];
      puede_revisar: boolean;
    }>(this.api, {
      headers: this.encabezados(),
      params,
    }).pipe(
      timeout(10000)
    ).subscribe({
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
    this.peticionFotos = from(this.sobrantes).pipe(
      filter((sobrante) => !!sobrante.foto_nombre),
      mergeMap((sobrante) => this.http.get(
        `${this.api}/${encodeURIComponent(sobrante.id)}/foto`,
        {
          headers: this.encabezados(),
          responseType: 'blob',
        }
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
    if (this.ocupado) return;
    if (this.hayCambios && !this.conflicto) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de abrir otro lote.';
      return;
    }
    this.cancelarBusqueda();
    this.seleccionado = sobrante;
    this.motivo = '';
    this.error = '';
    this.errorDetalle = '';
    this.mensajeDetalle = '';
    this.conflicto = false;
    this.prepararEdicion();
    this.detector.detectChanges();
    this.panelDetalle?.nativeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    this.panelDetalle?.nativeElement.focus({ preventScroll: true });
  }
  eliminar(sobrante: Sobrante): void {
    if (!this.puedeRevisar || this.ocupado) {
      return;
    }
    if (this.hayCambios) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de eliminar un sobrante.';
      return;
    }
    const confirmado = window.confirm(
      `¿Eliminar el sobrante ${sobrante.codigo_lote}? Esta acción eliminará definitivamente el lote y su fotografía.`
    );
    if (!confirmado) return;
    this.error = '';
    this.mensaje = '';
    this.eliminandoId = sobrante.id;
    this.http.delete<{ mensaje: string }>(
      `${this.api}/${encodeURIComponent(sobrante.id)}`,
      {
        headers: this.encabezados(),
        body: { version_datos: sobrante.version_datos },
      }
    ).subscribe({
      next: (respuesta) => {
        this.sobrantes = this.sobrantes.filter(
          (item) => item.id !== sobrante.id
        );
        const foto = this.fotos[sobrante.id];
        if (foto) {
          URL.revokeObjectURL(foto);
        }
        delete this.fotos[sobrante.id];
        delete this.fotosFallidas[sobrante.id];
        if (this.seleccionado?.id === sobrante.id) {
          this.seleccionado = null;
          this.edicion = null;
          this.materialElegido = null;
        }
        this.eliminandoId = null;
        this.mensaje = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.eliminandoId = null;
        this.error = this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }
  private prepararEdicion(): void {
    const detalle = this.seleccionado;
    if (!detalle) return;
    this.edicion = {
      materialId: detalle.material_id,
      descripcionManual: detalle.descripcion_manual || '',
      cantidad: Number(detalle.cantidad),
      unidad: detalle.unidad,
      ubicacion: detalle.ubicacion,
      ubicacionId: detalle.ubicacion_id ?? null,
      articuloCompleto: detalle.articulo_completo ?? null,
      observaciones: detalle.observaciones,
    };
    this.materialElegido = detalle.material_id ? {
      id: detalle.material_id,
      codigo: detalle.codigo,
      descripcion: detalle.descripcion,
      familia: detalle.familia,
      tipo: detalle.tipo,
    } : null;
    this.sincronizarZona();
    this.firmaOriginal = this.firma(this.edicion);
    this.cargarUnidadesEdicion();
    this.buscar = '';
  }
  descartarCambios(): void {
    if (this.ocupado) return;
    this.cancelarBusqueda();
    this.prepararEdicion();
    this.errorDetalle = '';
    this.mensajeDetalle = '';
    if (this.conflicto) {
      this.cargarSobrantes();
    }
  }
  cerrarDetalle(): void {
    if (this.ocupado) return;
    if (this.hayCambios && !this.conflicto) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de cerrar.';
      return;
    }
    this.cancelarBusqueda();
    this.seleccionado = null;
    this.edicion = null;
    this.materialElegido = null;
    this.motivo = '';
  }
  cambiarBusqueda(): void {
    this.cancelarBusqueda();
  }
  buscarMateriales(pagina = 1): void {
    if (!this.editable || this.ocupado || this.conflicto) return;
    this.cancelarBusqueda();
    if (!this.buscar.trim() || this.buscar.length > 200) {
      this.errorBusqueda = 'Escribe una descripción o código, de hasta 200 caracteres.';
      return;
    }
    this.buscando = true;
    const params = new HttpParams()
      .set('buscar', this.buscar.trim())
      .set('pagina', String(pagina));
    this.peticionBusqueda = this.http.get<{
      materiales: MaterialCatalogo[];
      total: number;
      pagina: number;
      totalPaginas: number;
    }>(this.apiCatalogo, {
      headers: this.encabezados(),
      params,
    }).pipe(
      timeout(10000)
    ).subscribe({
      next: (respuesta) => {
        this.resultados = respuesta.materiales;
        this.totalBusqueda = respuesta.total;
        this.paginaBusqueda = respuesta.pagina;
        this.totalPaginasBusqueda = respuesta.totalPaginas;
        this.busquedaRealizada = true;
        this.buscando = false;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.buscando = false;
        this.errorBusqueda = this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }
  elegirMaterial(material: MaterialCatalogo): void {
    if (!this.edicion || !this.editable || this.ocupado || this.conflicto) {
      return;
    }
    this.edicion.materialId = material.id;
    this.edicion.unidad = '';
    this.cargarUnidadesEdicion();
    this.materialElegido = material;
    this.mensajeDetalle = '';
  }
  dejarSinIdentificar(): void {
    if (!this.edicion || !this.editable || this.ocupado || this.conflicto) {
      return;
    }
    if (!this.edicion.descripcionManual.trim()) {
      this.edicion.descripcionManual =
        this.materialElegido?.descripcion ||
        this.seleccionado?.descripcion ||
        '';
    }
    this.edicion.materialId = null;
    this.cargarUnidadesEdicion();
    this.materialElegido = null;
    this.mensajeDetalle = '';
  }
  guardarCambios(): void {
    const datos = this.edicion;
    const sobrante = this.seleccionado;
    if (!datos || !sobrante || !this.editable || this.ocupado || this.conflicto) {
      return;
    }
    this.errorDetalle = '';
    this.mensajeDetalle = '';
    if (
      (!datos.materialId &&
        (datos.descripcionManual.trim().length < 3 ||
          datos.descripcionManual.length > 500)) ||
      datos.cantidad === null ||
      !Number.isFinite(datos.cantidad) ||
      datos.cantidad < 0.001 ||
      !/^[0-9]{1,12}(\.[0-9]{1,3})?$/.test(String(datos.cantidad)) ||
      this.cargandoUnidades ||
      !this.unidadesPermitidas.includes(datos.unidad) ||
      !this.ubicacionesZona.some((l) => l.id === datos.ubicacionId) ||
      ![0, 1].includes(datos.articuloCompleto as number) ||
      datos.observaciones.length > 1000
    ) {
      this.errorDetalle =
        'Revisa descripción, cantidad, unidad, ubicación y completo Sí/No. La cantidad admite hasta tres decimales.';
      return;
    }
    if (!this.hayCambios) {
      this.mensajeDetalle = 'No hay cambios para guardar.';
      return;
    }
    if (!Number.isInteger(sobrante.version_datos)) {
      this.errorDetalle =
        'El backend aún no está actualizado. Reinícialo y actualiza la lista.';
      return;
    }
    this.guardandoCambios = true;
    this.cancelarBusqueda();
    this.http.patch<{ mensaje: string; version_datos: number; ubicacion: string; ubicacion_id: number; articulo_completo: number }>(
      `${this.api}/${encodeURIComponent(sobrante.id)}/datos`,
      {
        material_id: datos.materialId,
        descripcion_manual: datos.materialId
          ? ''
          : datos.descripcionManual.trim(),
        cantidad: String(datos.cantidad),
        unidad: datos.unidad,
        ubicacion_id: datos.ubicacionId,
        articulo_completo: datos.articuloCompleto,
        observaciones: datos.observaciones.trim(),
        version_datos: sobrante.version_datos,
      },
      { headers: this.encabezados() }
    ).subscribe({
      next: (respuesta) => {
        sobrante.material_id = datos.materialId;
        if (!datos.materialId) {
          sobrante.descripcion_manual = datos.descripcionManual.trim();
        }
        sobrante.cantidad = String(datos.cantidad);
        sobrante.unidad = datos.unidad;
        sobrante.ubicacion = respuesta.ubicacion;
        sobrante.ubicacion_id = respuesta.ubicacion_id;
        sobrante.articulo_completo = respuesta.articulo_completo;
        sobrante.observaciones = datos.observaciones.trim();
        sobrante.version_datos = respuesta.version_datos;
        sobrante.codigo = this.materialElegido?.codigo || 'Sin código de catálogo';
        sobrante.descripcion =
          this.materialElegido?.descripcion ||
          sobrante.descripcion_manual ||
          '';
        sobrante.familia = this.materialElegido?.familia || 'Por identificar';
        sobrante.tipo = this.materialElegido?.tipo || 'Por identificar';
        this.guardandoCambios = false;
        this.prepararEdicion();
        this.mensajeDetalle = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.guardandoCambios = false;
        this.conflicto =
          error instanceof HttpErrorResponse &&
          (error.status === 409 || error.status === 0);
        this.errorDetalle = this.describirError(error);
        if (this.conflicto) {
          this.errorDetalle += ' Actualiza la lista antes de continuar.';
        }
        this.detector.markForCheck();
      },
    });
  }
  revisar(estado: 'aprobado' | 'rechazado'): void {
    const sobrante = this.seleccionado;
    if (!sobrante || !this.editable || this.ocupado || this.conflicto) {
      return;
    }
    this.errorDetalle = '';
    this.mensajeDetalle = '';
    if (this.hayCambios) {
      this.errorDetalle = 'Guarda o descarta los cambios antes de aprobar o rechazar.';
      return;
    }
    if (estado === 'aprobado' && !sobrante.material_id) {
      this.errorDetalle =
        'Asigna un material del catálogo y guarda los cambios antes de aprobar.';
      return;
    }
    if (estado === 'rechazado' && !this.motivo.trim()) {
      this.errorDetalle = 'Escribe el motivo del rechazo.';
      return;
    }
    if (!Number.isInteger(sobrante.version_datos)) {
      this.errorDetalle =
        'El backend aún no está actualizado. Reinícialo y actualiza la lista.';
      return;
    }
    this.revisando = true;
    this.http.patch<{ mensaje: string }>(
      `${this.api}/${encodeURIComponent(sobrante.id)}/revision`,
      {
        estado,
        motivo: this.motivo.trim(),
        version_datos: sobrante.version_datos,
      },
      { headers: this.encabezados() }
    ).subscribe({
      next: (respuesta) => {
        this.revisando = false;
        this.mensaje = respuesta.mensaje;
        this.cargarSobrantes();
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.revisando = false;
        this.conflicto =
          error instanceof HttpErrorResponse &&
          (error.status === 409 || error.status === 0);
        this.errorDetalle = this.describirError(error);
        if (this.conflicto) {
          this.errorDetalle += ' Actualiza la lista antes de continuar.';
        }
        this.detector.markForCheck();
      },
    });
  }
  private describirError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        return 'La sesión venció. Inicia sesión nuevamente.';
      }
      if (error.status === 0) {
        return 'Se perdió la conexión con el backend.';
      }
      if (typeof error.error?.mensaje === 'string') {
        return error.error.mensaje;
      }
      if (error.status === 403) {
        return 'No tienes permiso para esta acción.';
      }
    }
    return 'No se pudo completar la operación.';
  }
  private cancelarBusqueda(): void {
    this.peticionBusqueda?.unsubscribe();
    this.buscando = false;
    this.resultados = [];
    this.errorBusqueda = '';
    this.busquedaRealizada = false;
    this.paginaBusqueda = 1;
    this.totalBusqueda = 0;
    this.totalPaginasBusqueda = 0;
  }
  private liberarFotos(): void {
    this.peticionFotos?.unsubscribe();
    Object.values(this.fotos).forEach((url) => URL.revokeObjectURL(url));
    this.fotos = {};
    this.fotosFallidas = {};
  }
  ionViewWillLeave(): void {
    this.peticionLista?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
    this.cancelarBusqueda();
    this.liberarFotos();
    this.peticionUbicaciones?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
  }
  ngOnDestroy(): void {
    this.peticionLista?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
    this.cancelarBusqueda();
    this.liberarFotos();
    this.peticionUbicaciones?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
  }
}