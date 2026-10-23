import { Component, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { IonContent } from '@ionic/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timeout } from 'rxjs';
interface Guia {id:string;codigo:string;despacho:string;solicitud:string;proyecto:string;creado_en:string;recibido_por:string;entregado_por:string;solicitante:string;observaciones:string;}
interface Linea {sobrante_id:string;codigo_lote:string;codigo:string;descripcion:string;entregada:string;unidad:string;}
@Component({selector:'app-guias-salida',standalone:true,imports:[CommonModule,FormsModule,IonContent],templateUrl: './guias.html',
styleUrls: ['./guias.scss'],})
export class GuiasSalidaPage {
 private http=inject(HttpClient);private detector=inject(ChangeDetectorRef);private destroy=inject(DestroyRef);private api='http://localhost:3000/api/guias';private secuencia=0;
 buscar='';pagina=1;total=0;guias:Guia[]=[];guia:Guia|null=null;detalles:Linea[]=[];cargando=false;cargandoDetalle=false;error='';
 get headers():HttpHeaders{return new HttpHeaders({Authorization:`Bearer ${sessionStorage.getItem('token')||''}`});}
 get paginas():number{return Math.max(1,Math.ceil(this.total/20));}
 ionViewWillEnter():void{this.cargar();}
 cargar(reiniciar=false):void{
  if(reiniciar)this.pagina=1;this.cargando=true;this.guia=null;this.detalles=[];this.error='';++this.secuencia;this.cargandoDetalle=false;
  this.http.get<{guias:Guia[];total:number}>(this.api,{headers:this.headers,params:{q:this.buscar,pagina:this.pagina}}).pipe(timeout(15000),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{this.guias=r.guias;this.total=r.total;this.cargando=false;this.detector.markForCheck();},error:e=>{this.guias=[];this.cargando=false;this.error=e.error?.mensaje||'No se pudieron cargar las guías.';this.detector.markForCheck();}});
 }
 cambiar(n:number):void{this.pagina+=n;this.cargar();}
 ver(g:Guia):void{const secuencia=++this.secuencia;this.guia=null;this.detalles=[];this.cargandoDetalle=true;this.error='';this.http.get<{guia:Guia;detalles:Linea[]}>(`${this.api}/${g.id}`,{headers:this.headers}).pipe(timeout(15000),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{if(secuencia!==this.secuencia)return;this.guia=r.guia;this.detalles=r.detalles;this.cargandoDetalle=false;this.detector.markForCheck();},error:e=>{if(secuencia!==this.secuencia)return;this.cargandoDetalle=false;this.error=e.error?.mensaje||'No se pudo cargar el comprobante.';this.detector.markForCheck();}});}
 imprimir():void{
  const g=this.guia;if(!g)return;
  const escapar=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const fecha=new Date(g.creado_en).toLocaleString('es-CR');
  const filas=this.detalles.map(d=>`<tr><td>${escapar(d.codigo_lote)}</td><td>${escapar(d.codigo)}</td><td>${escapar(d.descripcion)}</td><td>${escapar(d.entregada)}</td><td>${escapar(d.unidad)}</td></tr>`).join('');
  const iframe=document.createElement('iframe');iframe.title='Imprimir guía de salida';iframe.style.cssText='position:fixed;width:1px;height:1px;left:-9999px;border:0';
  iframe.onload=()=>{iframe.contentWindow?.focus();iframe.contentWindow?.print();setTimeout(()=>iframe.remove(),60000);};
  iframe.srcdoc=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(g.codigo)}</title><style>@page{size:A4;margin:18mm}body{font:12px Arial;color:#17364b}h1{font-size:20px}h2{font-size:17px}table{width:100%;border-collapse:collapse;margin:25px 0}th,td{padding:10px 7px;border:1px solid #aaa;text-align:left;overflow-wrap:anywhere}th{background:#edf2f7}.firmas{display:flex;justify-content:space-between;margin-top:75px}.firmas p{width:44%;border-top:1px solid #444;padding-top:12px;text-align:center}.obs{white-space:pre-wrap}tr{break-inside:avoid}thead{display:table-header-group}</style></head><body><h1>STEEL · IEM</h1><h2>GUÍA DE SALIDA DE MATERIALES · ${escapar(g.codigo)}</h2><p>Fecha: ${escapar(fecha)}</p><p>Solicitud: ${escapar(g.solicitud)} · Despacho: ${escapar(g.despacho)}</p><p>Proyecto / destino: ${escapar(g.proyecto||'Sin indicar')}</p><p>Solicitante: ${escapar(g.solicitante)}</p><table><thead><tr><th>Lote</th><th>Código</th><th>Descripción</th><th>Entregado</th><th>Unidad</th></tr></thead><tbody>${filas}</tbody></table><p class="obs">Observaciones: ${escapar(g.observaciones||'Sin observaciones')}</p><div class="firmas"><p>Entregado por<br>${escapar(g.entregado_por)}</p><p>Recibido por<br>${escapar(g.recibido_por)}</p></div><p>Comprobante del despacho confirmado. No descuenta inventario nuevamente.</p></body></html>`;
  document.body.appendChild(iframe);
 }
}
