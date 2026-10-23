import { Component, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonContent } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
interface Solicitud { id:string; codigo:string; solicitante:string; proyecto:string; estado:string; observaciones:string; }
interface Linea { sobrante_id:string; codigo_lote:string; descripcion:string; unidad:string; cantidad:string; existencia:string; entregada:number; motivo_faltante:string; }
interface Envio { solicitud_id:string; clave_envio:string; recibido_por:string; observaciones:string; articulos:{sobrante_id:string; entregada:string; motivo_faltante:string}[]; }
@Component({selector:'app-despachos',standalone:true,imports:[CommonModule,FormsModule,IonContent],templateUrl:'./despachos.page.html',styleUrls:['./despachos.page.scss']})
export class DespachosPage {
 private http=inject(HttpClient); private detector=inject(ChangeDetectorRef); private destroy=inject(DestroyRef);
 private api='http://localhost:3000/api/despachos'; private secuencia=0;
 solicitudes:Solicitud[]=[]; seleccion:Solicitud|null=null; lineas:Linea[]=[];
 pagina=1; total=0; cargando=false; cargandoDetalle=false; enviando=false; error=''; mensaje=''; receptor=''; observaciones=''; pendiente:Envio|null=null;
 get headers():HttpHeaders{return new HttpHeaders({Authorization:`Bearer ${sessionStorage.getItem('token')||''}`});}
 get paginas():number{return Math.max(1,Math.ceil(this.total/20));}
 ionViewWillEnter():void{if(!this.pendiente)this.cargar();}
 cargar():void{
  if(this.enviando||this.pendiente)return;
  this.cargando=true;this.error='';this.seleccion=null;this.lineas=[];++this.secuencia;this.cargandoDetalle=false;
  this.http.get<{solicitudes:Solicitud[];total:number}>(`${this.api}/pendientes?pagina=${this.pagina}`,{headers:this.headers}).pipe(timeout(15000),takeUntilDestroyed(this.destroy)).subscribe({
   next:r=>{this.solicitudes=r.solicitudes;this.total=r.total;this.cargando=false;this.detector.markForCheck();},
   error:e=>{this.solicitudes=[];this.error=e.error?.mensaje||'No se pudo cargar la lista.';this.cargando=false;this.detector.markForCheck();}
  });
 }
 cambiar(n:number):void{this.pagina+=n;this.cargar();}
 ver(s:Solicitud):void{
  if(this.enviando||this.pendiente)return;
  const secuencia=++this.secuencia;this.seleccion=null;this.lineas=[];this.cargandoDetalle=true;this.error='';this.mensaje='';this.receptor='';this.observaciones='';
  this.http.get<{solicitud:Solicitud;detalles:Linea[]}>(`${this.api}/solicitud/${s.id}`,{headers:this.headers}).pipe(timeout(15000),takeUntilDestroyed(this.destroy)).subscribe({
   next:r=>{if(secuencia!==this.secuencia)return;this.seleccion=r.solicitud;this.lineas=r.detalles.map(d=>({...d,entregada:Number(d.cantidad),motivo_faltante:''}));this.cargandoDetalle=false;this.detector.markForCheck();},
   error:e=>{if(secuencia!==this.secuencia)return;this.error=e.error?.mensaje||'No se pudo cargar el detalle.';this.cargandoDetalle=false;this.detector.markForCheck();}
  });
 }
 confirmar():void{
  if(this.enviando)return;
  if(!this.pendiente){
   if(!this.seleccion||this.seleccion.estado!=='aprobada')return;
   this.error='';
   if(!this.receptor.trim()||this.receptor.length>150||this.observaciones.length>1000){this.error='Indica quién recibe y revisa la longitud de los textos.';return;}
   if(this.lineas.some(d=>!/^\d{1,12}(\.\d{1,3})?$/.test(String(d.entregada))||Number(d.entregada)>Number(d.cantidad)||d.motivo_faltante.length>500||(Number(d.entregada)<Number(d.cantidad)&&!d.motivo_faltante.trim()))){this.error='Revisa las cantidades y escribe el motivo de cada faltante.';return;}
   if(!window.confirm('¿Confirmar y cerrar este despacho? Se descontará solo lo entregado y se liberará el resto de la reserva.'))return;
   this.pendiente={solicitud_id:this.seleccion.id,clave_envio:crypto.randomUUID(),recibido_por:this.receptor.trim(),observaciones:this.observaciones.trim(),articulos:this.lineas.map(d=>({sobrante_id:d.sobrante_id,entregada:String(d.entregada),motivo_faltante:d.motivo_faltante.trim()}))};
  }
  this.enviando=true;this.error='';
  this.http.post<{codigo:string;mensaje:string}>(this.api,this.pendiente,{headers:this.headers}).pipe(timeout(20000),takeUntilDestroyed(this.destroy)).subscribe({
   next:r=>{this.enviando=false;this.pendiente=null;this.mensaje=`${r.codigo}: ${r.mensaje}`;this.cargar();this.detector.markForCheck();},
   error:e=>{this.enviando=false;this.error=e.error?.mensaje||'No se recibió confirmación. Pulsa Reintentar confirmación con los mismos datos.';if([400,403,404,409].includes(e.status))this.pendiente=null;this.detector.markForCheck();}
  });
 }
}
