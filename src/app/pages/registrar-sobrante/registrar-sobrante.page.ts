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

  private peticionFamilias?: Subscription;
  private peticionTipos?: Subscription;
  private peticionMateriales?: Subscription;

  familias: Familia[] = [];
  tipos: string[] = [];
  materiales: MaterialCatalogo[] = [];

  familia = '';
  tipo = '';
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
  ubicacion = '';
  observaciones = '';

  foto: File | null = null;
  vistaFoto = '';
  mensaje = '';
  errorFoto = '';

  guardando = false;
  guardado = false;

  ionViewWillEnter(): void {
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
    this.tipo = '';
    this.tipos = [];
    this.seleccionado = null;

    if (!this.guardando && !this.guardado) {
      this.mensaje = '';
    }

    this.cargarTipos();
    this.buscarMateriales();
  }

  cambiarTipo(): void {
    this.seleccionado = null;

    if (!this.guardando && !this.guardado) {
      this.mensaje = '';
    }

    this.buscarMateriales();
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
    if (this.guardando || this.guardado) {
      return;
    }

    this.seleccionado = material;
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

    if (!this.seleccionado) {
      this.mensaje = 'Selecciona un material del catálogo.';
      return;
    }

    const cantidadTexto = String(this.cantidad ?? '');

    if (
      formulario.invalid ||
      !this.ubicacion.trim() ||
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

    datos.append('material_id', String(this.seleccionado.id));
    datos.append('cantidad', cantidadTexto);
    datos.append('unidad', this.unidad);
    datos.append('ubicacion', this.ubicacion.trim());
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

    formulario.resetForm({
      familia: '',
      tipo: '',
      cantidad: null,
      unidad: '',
      ubicacion: '',
      observaciones: '',
    });

    this.familia = '';
    this.tipo = '';
    this.cantidad = null;
    this.unidad = '';
    this.ubicacion = '';
    this.observaciones = '';

    this.cargarTipos();
    this.buscarMateriales();
  }

  ionViewWillLeave(): void {
    this.cancelarPeticionesCatalogo();
  }

  ngOnDestroy(): void {
    this.cancelarPeticionesCatalogo();
    this.liberarVistaFoto();
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