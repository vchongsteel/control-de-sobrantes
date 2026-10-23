const express = require('express');
const { randomUUID } = require('node:crypto');
const db = require('./db');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const codigo = n => `DES-${String(n).padStart(3, '0')}`;
function cantidad(v) {
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(String(v))) return null;
  const [a,b=''] = String(v).split('.'); const n = Number(a)*1000+Number(b.padEnd(3,'0'));
  return Number.isSafeInteger(n) ? n : null;
}
const decimal = n => `${Math.floor(n/1000)}.${String(n%1000).padStart(3,'0')}`;
const fallo = (mensaje,status=400) => Object.assign(new Error(mensaje),{status});
module.exports = comprobarSesion => {
 const router = express.Router();
 router.use(comprobarSesion);
 router.use((req,res,next) => req.cuenta?.roles?.some(r=>['bodega','supervisor','administrador'].includes(r)) ? next() : res.status(403).json({mensaje:'No tienes permiso para gestionar despachos.'}));
 router.get('/pendientes', async(req,res)=>{
  const pagina=Number(req.query.pagina||1);
  if(!Number.isInteger(pagina)||pagina<1||pagina>100000) return res.status(400).json({mensaje:'Página inválida.'});
  try {
   const [[c]]=await db.execute("SELECT COUNT(*) AS total FROM solicitudes WHERE estado='aprobada'");
   const [solicitudes]=await db.execute(`SELECT p.id,p.numero,p.proyecto,p.creado_en,u.nombre AS solicitante FROM solicitudes p JOIN usuarios u ON u.id=p.solicitado_por WHERE p.estado='aprobada' ORDER BY p.creado_en,p.numero LIMIT 20 OFFSET ${20*(pagina-1)}`);
   res.json({total:Number(c.total),solicitudes:solicitudes.map(s=>({...s,codigo:`SOL-${String(s.numero).padStart(3,'0')}`}))});
  }catch(e){console.error('Pendientes despacho:',e.code);res.status(500).json({mensaje:'No se pudieron cargar los despachos pendientes.'});}
 });
 router.get('/solicitud/:id',async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({mensaje:'Solicitud inválida.'});
  try{
   const [filas]=await db.execute(`SELECT p.id,p.numero,p.estado,p.proyecto,p.observaciones,u.nombre AS solicitante FROM solicitudes p JOIN usuarios u ON u.id=p.solicitado_por WHERE p.id=?`,[req.params.id]);
   if(!filas.length)return res.status(404).json({mensaje:'Solicitud no disponible.'});
   const [detalles]=await db.execute(`SELECT d.*,s.cantidad AS existencia FROM solicitud_detalles d JOIN sobrantes s ON s.id=d.sobrante_id WHERE d.solicitud_id=? ORDER BY d.sobrante_id`,[req.params.id]);
   res.json({solicitud:{...filas[0],codigo:`SOL-${String(filas[0].numero).padStart(3,'0')}`},detalles});
  }catch(e){console.error('Detalle despacho:',e.code);res.status(500).json({mensaje:'No se pudo cargar el detalle.'});}
 });
 router.post('/',async(req,res)=>{
  const {solicitud_id,clave_envio,recibido_por,observaciones='',articulos}=req.body||{};
  if(!uuid.test(solicitud_id||'')||!uuid.test(clave_envio||'')||typeof recibido_por!=='string'||!recibido_por.trim()||recibido_por.length>150||typeof observaciones!=='string'||observaciones.length>1000||!Array.isArray(articulos)||!articulos.length||articulos.length>50) return res.status(400).json({mensaje:'Completa el receptor y revisa los datos del despacho.'});
  const items=articulos.map(a=>({id:a?.sobrante_id,entregada:cantidad(a?.entregada),motivo:a?.motivo_faltante||''}));
  if(items.some(a=>!uuid.test(a.id||'')||a.entregada===null||typeof a.motivo!=='string'||a.motivo.length>500)||new Set(items.map(a=>a.id)).size!==items.length) return res.status(400).json({mensaje:'Revisa las cantidades (hasta tres decimales) y los motivos.'});
  let cx;
  try{
   cx=await db.getConnection();await cx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await cx.beginTransaction();
   const [filas]=await cx.execute('SELECT id,estado FROM solicitudes WHERE id=? FOR UPDATE',[solicitud_id]);
   if(!filas.length)throw fallo('Solicitud no disponible.',404);
   const [previos]=await cx.execute('SELECT id,numero,clave_envio FROM despachos WHERE solicitud_id=?',[solicitud_id]);
   if(previos.length){
    if(previos[0].clave_envio!==clave_envio)throw fallo('Esta solicitud ya fue despachada. Actualiza la lista.',409);
    await cx.commit();return res.json({id:previos[0].id,codigo:codigo(previos[0].numero),mensaje:'Este despacho ya estaba registrado.'});
   }
   if(filas[0].estado!=='aprobada')throw fallo('Solo se pueden despachar solicitudes aprobadas.',409);
   const [lineas]=await cx.execute('SELECT sobrante_id,cantidad FROM solicitud_detalles WHERE solicitud_id=? ORDER BY sobrante_id',[solicitud_id]);
   if(lineas.length!==items.length||lineas.some(d=>!items.some(a=>a.id===d.sobrante_id)))throw fallo('Debes indicar todos los lotes de la solicitud.');
   const preparadas=[];
   // Bloquear siempre los lotes en el mismo orden evita entregas concurrentes del mismo saldo.
   for(const d of lineas){
    const a=items.find(a=>a.id===d.sobrante_id),solicitada=cantidad(d.cantidad);
    if(solicitada===null||a.entregada>solicitada)throw fallo('La entrega no puede superar la cantidad solicitada.');
    if(a.entregada<solicitada&&!a.motivo.trim())throw fallo('Indica el motivo de cada faltante o daño.');
    const [lotes]=await cx.execute('SELECT id,cantidad,estado FROM sobrantes WHERE id=? FOR UPDATE',[a.id]);
    const stock=lotes.length?cantidad(lotes[0].cantidad):null;
    if(stock===null||lotes[0].estado!=='aprobado')throw fallo('Un lote ya no está disponible para entregar.',409);
    const [[reservas]]=await cx.execute(`SELECT COALESCE(SUM(d.cantidad),0) AS reservada FROM solicitud_detalles d JOIN solicitudes p ON p.id=d.solicitud_id WHERE d.sobrante_id=? AND p.id<>? AND p.estado IN ('enviada','aprobada')`,[a.id,solicitud_id]);
    const otras=cantidad(reservas.reservada);
    if(otras===null||stock-a.entregada<otras)throw fallo('El inventario cambió y no alcanza para esta entrega y las demás reservas.',409);
    preparadas.push({...a,solicitada});
   }
   const id=randomUUID();
   await cx.execute('INSERT INTO despachos(id,solicitud_id,clave_envio,despachado_por,recibido_por,observaciones) VALUES(?,?,?,?,?,?)',[id,solicitud_id,clave_envio,req.cuenta.id,recibido_por.trim(),observaciones.trim()]);
   for(const a of preparadas){
    await cx.execute('INSERT INTO despacho_detalles(despacho_id,sobrante_id,solicitada,entregada,motivo_faltante) VALUES(?,?,?,?,?)',[id,a.id,decimal(a.solicitada),decimal(a.entregada),a.motivo.trim()]);
    await cx.execute('UPDATE sobrantes SET cantidad=cantidad-?, version_datos=version_datos+1 WHERE id=?',[decimal(a.entregada),a.id]);
   }
   await cx.execute("UPDATE solicitudes SET estado='despachada' WHERE id=?",[solicitud_id]);
   const [[nuevo]]=await cx.execute('SELECT numero FROM despachos WHERE id=?',[id]);
   await cx.commit();return res.status(201).json({id,codigo:codigo(nuevo.numero),mensaje:'Despacho confirmado. Se descontó lo entregado y se cerró la reserva.'});
  }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('Confirmar despacho:',e.code||e.status);return res.status(e.status||500).json({mensaje:e.status?e.message:'No se confirmó el despacho. Reintenta con los mismos datos para comprobarlo.'});}
  finally{if(cx)cx.release();}
 });
 return router;
};
