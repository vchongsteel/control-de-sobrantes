import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  inject,
} from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { Subscription, timeout } from 'rxjs';
interface Ubicacion { id: number; codigo: string; nombre: string; temporal: number; zona: string; ubicacion: string; }
interface Familia {
  id: number;
  codigo: string;
  nombre: string;
  total_materiales: number;
}
interface MaterialCatalogo {
  id: number;
  codigo: string;
  familia_codigo: string;
  familia: string;
  tipo: string;
  descripcion: string;
  estado_catalogo: string;
}
interface RespuestaMateriales {
  materiales: MaterialCatalogo[];
  total: number;
  pagina: number;
  porPagina: number;
  totalPaginas: number;
}
interface RespuestaRegistro {
  mensaje: string;
  id: string;
  codigo_lote: string;
  estado: 'pendiente';
  identificacion: 'manual' | 'catalogo';
}
@Component({
  selector: 'app-registrar-sobrante',
  templateUrl: './registrar-sobrante.page.html',
  styleUrls: ['./registrar-sobrante.page.scss'],
  standalone: true,
  imports: [
    FormsModule,
    IonBackButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
  ],
})
export class RegistrarSobrantePage implements OnDestroy {
  private http = inject(HttpClient);
  private detector = inject(ChangeDetectorRef);
  private api = 'http://localhost:3000/api/catalogo';
  private apiSobrantes = 'http://localhost:3000/api/sobrantes';
  private peticionUbicaciones?: Subscription;
  private peticionUnidades?: Subscription;
  ubicaciones: Ubicacion[] = [];
  zona = '';
  get zonas(): string[] {
    return [...new Set(this.ubicaciones.map((l) => l.zona))];
  }
  get ubicacionesZona(): Ubicacion[] {
    return this.ubicaciones.filter((l) => l.zona === this.zona);
  }
  cambiarZona(): void {
    this.ubicacionId = null;
  }
  cargandoUbicaciones = false;
  cargandoUnidades = false;
  errorUbicaciones = '';
  errorUnidades = '';
  unidadesPermitidas: string[] = [];
  readonly unidadesGenerales = ['unidades', 'kg', 'm', 'm2', 'm3', 'litros'];
  nombreUnidad(unidad: string): string {
    return ({ unidades: 'Unidades', kg: 'Kilogramos', m: 'Metros', m2: 'Metros cuadrados', m3: 'Metros cúbicos', litros: 'Litros' } as Record<string, string>)[unidad] || unidad;
  }
  cargarUbicaciones(): void {
    this.peticionUbicaciones?.unsubscribe();
    this.cargandoUbicaciones = true;
    this.errorUbicaciones = '';
    this.peticionUbicaciones = this.http.get<{ ubicaciones: Ubicacion[] }>(
      'http://localhost:3000/api/ubicaciones', { headers: this.encabezados() }
    ).pipe(timeout(10000)).subscribe({
      next: (r) => {
        this.ubicaciones = r.ubicaciones;
        if (this.ubicacionId !== null) {
          this.zona = r.ubicaciones.find((l) => l.id === this.ubicacionId)?.zona || '';
        }
        this.cargandoUbicaciones = false;
        if (!r.ubicaciones.length) this.errorUbicaciones = 'No hay ubicaciones activas.';
        this.detector.markForCheck();
      },
      error: (e: unknown) => {
        this.cargandoUbicaciones = false;
        this.errorUbicaciones = this.describirError(e);
        this.detector.markForCheck();
      },
    });
  }
  private reiniciarUnidades(): void {
    this.peticionUnidades?.unsubscribe();
    this.cargandoUnidades = false;
    this.errorUnidades = '';
    this.unidad = '';
    this.unidadesPermitidas = this.modo === 'manual' ? [...this.unidadesGenerales] : [];
  }
  cargarUnidades(): void {
    this.reiniciarUnidades();
    const material = this.seleccionado;
    if (!material || this.modo !== 'catalogo') return;
    this.cargandoUnidades = true;
    this.peticionUnidades = this.http.get<{ unidades: string[] }>(
      `${this.api}/materiales/${material.id}/unidades`, { headers: this.encabezados() }
    ).pipe(timeout(10000)).subscribe({
      next: (r) => {
        this.unidadesPermitidas = r.unidades;
        this.cargandoUnidades = false;
        if (r.unidades.length === 1) this.unidad = r.unidades[0];
        if (!r.unidades.length) this.errorUnidades = 'Este material no tiene unidades configuradas. Consulta al supervisor o usa el registro manual.';
        this.detector.markForCheck();
      },
      error: (e: unknown) => {
        this.cargandoUnidades = false;
        this.errorUnidades = this.describirError(e);
        this.detector.markForCheck();
      },
    });
  }
  private peticionFamilias?: Subscription;
  private peticionTipos?: Subscription;
  private peticionMateriales?: Subscription;
  familias: Familia[] = [];
  tipos: string[] = [];
  materiales: MaterialCatalogo[] = [];
  familia = '';
  tipo = '';
  buscar = '';
  modo: 'catalogo' | 'manual' = 'catalogo';
  descripcionManual = '';
  codigoLote = '';
  seleccionado: MaterialCatalogo | null = null;
  pagina = 1;
  total = 0;
  totalPaginas = 0;
  consultaRealizada = false;
  cargandoFamilias = false;
  cargandoTipos = false;
  cargandoMateriales = false;
  errorCatalogo = '';
  cantidad: number | null = null;
  unidad = '';
  ubicacionId: number | null = null;
  articuloCompleto: number | null = null;
  observaciones = '';
  foto: File | null = null;
  vistaFoto = '';
  mensaje = '';
  errorFoto = '';
  guardando = false;
  guardado = false;
  ionViewWillEnter(): void {
    this.cargarUbicaciones();
    if (this.modo === 'manual') {
      return;
    }
    this.cargarFamilias();
    this.cargarTipos();
    this.buscarMateriales();
  }
  private encabezados(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${sessionStorage.getItem('token') || ''}`,
    });
  }
  cargarFamilias(): void {
    this.peticionFamilias?.unsubscribe();
    this.cargandoFamilias = true;
    this.errorCatalogo = '';
    this.detector.markForCheck();
    this.peticionFamilias = this.http
      .get<{ familias: Familia[] }>(
        `${this.api}/familias`,
        { headers: this.encabezados() }
      )
      .pipe(timeout(10000))
      .subscribe({
        next: (respuesta) => {
          this.familias = respuesta.familias;
          this.cargandoFamilias = false;
          this.detector.markForCheck();
        },
        error: (error: unknown) => {
          this.cargandoFamilias = false;
          this.errorCatalogo = this.describirError(error);
          this.detector.markForCheck();
        },
      });
  }
  cambiarFamilia(): void {
    if (this.guardando || this.guardado || this.modo !== 'catalogo') return;
    this.tipo = '';
    this.tipos = [];
    this.seleccionado = null;
    this.reiniciarUnidades();
    if (!this.guardando && !this.guardado) {
      this.mensaje = '';
    }
    this.cargarTipos();
    this.buscarMateriales();
  }
  cambiarTipo(): void {
    if (this.guardando || this.guardado || this.modo !== 'catalogo') return;
    this.seleccionado = null;
    this.reiniciarUnidades();
    if (!this.guardando && !this.guardado) {
      this.mensaje = '';
    }
    this.buscarMateriales();
  }
  cambiarModo(modo: 'catalogo' | 'manual'): void {
    if (this.guardando || this.guardado || modo === this.modo) return;
    this.cancelarPeticionesCatalogo();
    this.cargandoFamilias = false;
    this.cargandoTipos = false;
    this.cargandoMateriales = false;
    this.modo = modo;
    this.seleccionado = null;
    this.reiniciarUnidades();
    this.errorCatalogo = '';
    this.mensaje = '';
    this.materiales = [];
    this.consultaRealizada = false;
    this.total = 0;
    this.totalPaginas = 0;
    this.pagina = 1;
    if (modo === 'catalogo') {
      this.cargarFamilias();
      this.cargarTipos();
      this.buscarMateriales();
    }
    // La foto y los datos del sobrante se conservan al cambiar de modo.
  }
  cambiarTexto(): void {
    if (this.guardando || this.guardado || this.modo !== 'catalogo') return;
    this.peticionMateriales?.unsubscribe();
    this.cargandoMateriales = false;
    this.materiales = [];
    this.seleccionado = null;
    this.reiniciarUnidades();
    this.consultaRealizada = false;
    this.pagina = 1;
    this.total = 0;
    this.totalPaginas = 0;
    this.errorCatalogo = '';
    this.mensaje = '';
  }
  private cargarTipos(): void {
    this.peticionTipos?.unsubscribe();
    this.cargandoTipos = true;
    this.detector.markForCheck();
    let params = new HttpParams();
    if (this.familia) {
      params = params.set('familia', this.familia);
    }
    this.peticionTipos = this.http
      .get<{ tipos: string[] }>(
        `${this.api}/tipos`,
        {
          headers: this.encabezados(),
          params,
        }
      )
      .pipe(timeout(10000))
      .subscribe({
        next: (respuesta) => {
          this.tipos = respuesta.tipos;
          this.cargandoTipos = false;
          this.detector.markForCheck();
        },
        error: (error: unknown) => {
          this.tipos = [];
          this.cargandoTipos = false;
          this.errorCatalogo = this.describirError(error);
          this.detector.markForCheck();
        },
      });
  }
  buscarMateriales(pagina = 1): void {
    if (this.modo !== 'catalogo') return;
    if (this.buscar.length > 200) {
      this.errorCatalogo = 'La búsqueda admite como máximo 200 caracteres.';
      return;
    }
    this.peticionMateriales?.unsubscribe();
    this.cargandoMateriales = true;
    this.consultaRealizada = false;
    this.materiales = [];
    this.total = 0;
    this.totalPaginas = 0;
    this.errorCatalogo = '';
    this.pagina = pagina;
    this.detector.markForCheck();
    let params = new HttpParams()
      .set('pagina', String(pagina));
    if (this.familia) {
      params = params.set('familia', this.familia);
    }
    if (this.tipo) {
      params = params.set('tipo', this.tipo);
    }
    if (this.buscar.trim()) {
      params = params.set('buscar', this.buscar.trim());
    }
    this.peticionMateriales = this.http
      .get<RespuestaMateriales>(
        `${this.api}/materiales`,
        {
          headers: this.encabezados(),
          params,
        }
      )
      .pipe(timeout(10000))
      .subscribe({
        next: (respuesta) => {
          this.materiales = respuesta.materiales;
          this.total = respuesta.total;
          this.pagina = respuesta.pagina;
          this.totalPaginas = respuesta.totalPaginas;
          this.consultaRealizada = true;
          this.cargandoMateriales = false;
          this.detector.markForCheck();
        },
        error: (error: unknown) => {
          this.cargandoMateriales = false;
          this.errorCatalogo = this.describirError(error);
          this.detector.markForCheck();
        },
      });
  }
  seleccionarMaterial(material: MaterialCatalogo): void {
    if (this.guardando || this.guardado || this.modo !== 'catalogo') {
      return;
    }
    this.seleccionado = material;
    this.cargarUnidades();
    this.mensaje = '';
  }
  private describirError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        return 'La sesión no es válida. Cierra sesión e ingresa nuevamente.';
      }
      if (error.status === 0) {
        return 'No se pudo conectar con el backend. Comprueba que esté funcionando.';
      }
      if (typeof error.error?.mensaje === 'string') {
        return error.error.mensaje;
      }
    }
    return 'No se pudo completar la operación. Intenta nuevamente.';
  }
  seleccionarFoto(event: Event): void {
    if (this.guardando || this.guardado) {
      return;
    }
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) {
      return;
    }
    this.errorFoto = '';
    this.mensaje = '';
    this.liberarVistaFoto();
    this.foto = null;
    const tiposPermitidos = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (!tiposPermitidos.includes(archivo.type)) {
      this.errorFoto = 'Selecciona una foto JPG, PNG o WEBP.';
      input.value = '';
      return;
    }
    if (archivo.size > 5 * 1024 * 1024) {
      this.errorFoto = 'La foto debe pesar como máximo 5 MB.';
      input.value = '';
      return;
    }
    this.foto = archivo;
    this.vistaFoto = URL.createObjectURL(archivo);
  }
  eliminarFoto(input: HTMLInputElement): void {
    if (this.guardando || this.guardado) {
      return;
    }
    this.liberarVistaFoto();
    this.foto = null;
    this.errorFoto = '';
    this.mensaje = '';
    input.value = '';
  }
  revisarDatos(formulario: NgForm): void {
    if (this.guardando || this.guardado) {
      return;
    }
    this.mensaje = '';
    if (this.modo === 'catalogo' && !this.seleccionado) {
      this.mensaje = 'Selecciona un material del catálogo.';
      return;
    }
    if (this.modo === 'manual' && (
      this.descripcionManual.trim().length < 3 || this.descripcionManual.length > 500
    )) {
      formulario.control.markAllAsTouched();
      this.mensaje = 'Describe el material con entre 3 y 500 caracteres.';
      return;
    }
    const cantidadTexto = String(this.cantidad ?? '');
    if (
      formulario.invalid ||
      this.cargandoUbicaciones || this.cargandoUnidades ||
      !this.ubicacionesZona.some((l) => l.id === this.ubicacionId) ||
      ![0, 1].includes(this.articuloCompleto as number) ||
      !this.unidadesPermitidas.includes(this.unidad) ||
      this.cantidad === null ||
      !Number.isFinite(this.cantidad) ||
      this.cantidad < 0.001 ||
      !/^[0-9]{1,12}(\.[0-9]{1,3})?$/.test(cantidadTexto)
    ) {
      formulario.control.markAllAsTouched();
      this.mensaje =
        'Completa los campos obligatorios. La cantidad debe ser mayor que cero y admite hasta tres decimales.';
      return;
    }
    if (this.errorFoto) {
      this.mensaje = 'Corrige la fotografía antes de guardar.';
      return;
    }
    const token = sessionStorage.getItem('token');
    if (!token) {
      this.mensaje = 'Inicia sesión nuevamente para guardar.';
      return;
    }
    const datos = new FormData();
    if (this.modo === 'manual') {
      datos.append('descripcion_manual', this.descripcionManual.trim());
    } else {
      datos.append('material_id', String(this.seleccionado!.id));
    }
    datos.append('cantidad', cantidadTexto);
    datos.append('unidad', this.unidad);
    datos.append('ubicacion_id', String(this.ubicacionId));
    datos.append('articulo_completo', String(this.articuloCompleto));
    datos.append('observaciones', this.observaciones.trim());
    if (this.foto) {
      datos.append('foto', this.foto, this.foto.name);
    }
    this.guardando = true;
    this.mensaje = 'Guardando sobrante…';
    this.http.post<RespuestaRegistro>(
      this.apiSobrantes,
      datos,
      {
        headers: new HttpHeaders({
          Authorization: `Bearer ${token}`,
        }),
      }
    ).subscribe({
      next: (respuesta) => {
        this.guardando = false;
        this.guardado = true;
        this.codigoLote = respuesta.codigo_lote;
        this.mensaje = respuesta.mensaje;
        this.detector.markForCheck();
      },
      error: (error: unknown) => {
        this.guardando = false;
        this.mensaje =
          error instanceof HttpErrorResponse && error.status === 0
            ? 'Se perdió la conexión. Comprueba en MySQL si se guardó antes de repetir el envío.'
            : this.describirError(error);
        this.detector.markForCheck();
      },
    });
  }
  nuevoRegistro(
    formulario: NgForm,
    inputFoto: HTMLInputElement
  ): void {
    if (this.guardando) {
      return;
    }
    this.liberarVistaFoto();
    this.foto = null;
    inputFoto.value = '';
    this.errorFoto = '';
    this.mensaje = '';
    this.guardado = false;
    this.seleccionado = null;
    this.reiniciarUnidades();
    this.modo = 'catalogo';
    this.reiniciarUnidades();
    this.descripcionManual = '';
    this.codigoLote = '';
    formulario.resetForm({
      familia: '',
      tipo: '',
      buscar: '',
      descripcionManual: '',
      cantidad: null,
      unidad: '',
      zona: '',
      ubicacionId: null,
      articuloCompleto: null,
      observaciones: '',
    });
    this.familia = '';
    this.tipo = '';
    this.buscar = '';
    this.cantidad = null;
    this.unidad = '';
    this.zona = '';
    this.ubicacionId = null;
    this.articuloCompleto = null;
    this.observaciones = '';
    this.cargarFamilias();
    this.cargarTipos();
    this.buscarMateriales();
  }
  ionViewWillLeave(): void {
    this.cancelarPeticionesCatalogo();
    this.peticionUbicaciones?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
  }
  ngOnDestroy(): void {
    this.cancelarPeticionesCatalogo();
    this.liberarVistaFoto();
    this.peticionUbicaciones?.unsubscribe();
    this.peticionUnidades?.unsubscribe();
  }
  private cancelarPeticionesCatalogo(): void {
    this.peticionFamilias?.unsubscribe();
    this.peticionTipos?.unsubscribe();
    this.peticionMateriales?.unsubscribe();
  }
  private liberarVistaFoto(): void {
    if (this.vistaFoto) {
      URL.revokeObjectURL(this.vistaFoto);
      this.vistaFoto = '';
    }
  }
}