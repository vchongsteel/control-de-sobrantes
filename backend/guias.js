const express = require('express');
const db = require('./db');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const codigo = (p,n) => `${p}-${String(n).padStart(3,'0')}`;
module.exports = comprobarSesion => {
 const router=express.Router();router.use(comprobarSesion);
 router.use((req,res,next)=>req.cuenta?.roles?.some(r=>['administrador','supervisor','bodega','colaborador'].includes(r))?next():res.status(403).json({mensaje:'No tienes permiso para consultar guías.'}));
 const gestor=c=>c.roles.some(r=>['administrador','supervisor','bodega'].includes(r));
 router.get('/',async(req,res)=>{
  const q=typeof req.query.q==='string'?req.query.q.trim():'';const pagina=Number(req.query.pagina||1);
  if(q.length>200||!Number.isInteger(pagina)||pagina<1||pagina>100000)return res.status(400).json({mensaje:'Revisa la búsqueda.'});
  const condiciones=['EXISTS (SELECT 1 FROM despacho_detalles x WHERE x.despacho_id=d.id AND x.entregada>0)'];const params=[];
  if(!gestor(req.cuenta)){condiciones.push('s.solicitado_por=?');params.push(req.cuenta.id);}
  if(q){condiciones.push("(LOCATE(?,s.proyecto)>0 OR LOCATE(?,CONCAT('GUI-',LPAD(d.numero,GREATEST(3,CHAR_LENGTH(d.numero)),'0')))>0 OR LOCATE(?,CONCAT('SOL-',LPAD(s.numero,GREATEST(3,CHAR_LENGTH(s.numero)),'0')))>0)");params.push(q,q,q);}
  const base=`FROM despachos d JOIN solicitudes s ON s.id=d.solicitud_id WHERE ${condiciones.join(' AND ')}`;
  try{
   const [[c]]=await db.execute(`SELECT COUNT(*) AS total ${base}`,params);
   const [filas]=await db.execute(`SELECT d.id,d.numero,d.creado_en,s.numero AS solicitud_numero,s.proyecto ${base} ORDER BY d.creado_en DESC,d.numero DESC LIMIT 20 OFFSET ${20*(pagina-1)}`,params);
   res.json({total:Number(c.total),guias:filas.map(g=>({...g,codigo:codigo('GUI',g.numero),despacho:codigo('DES',g.numero),solicitud:codigo('SOL',g.solicitud_numero)}))});
  }catch(e){console.error('Guías:',e.code);res.status(500).json({mensaje:'No se pudieron consultar las guías.'});}
 });
 router.get('/:id',async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({mensaje:'Guía inválida.'});
  try{
   const [filas]=await db.execute(`SELECT d.id,d.solicitud_id,d.numero,d.creado_en,d.recibido_por,d.observaciones,s.numero AS solicitud_numero,s.proyecto,s.solicitado_por,u.nombre AS entregado_por,v.nombre AS solicitante FROM despachos d JOIN solicitudes s ON s.id=d.solicitud_id JOIN usuarios u ON u.id=d.despachado_por JOIN usuarios v ON v.id=s.solicitado_por WHERE d.id=?`,[req.params.id]);
   const g=filas[0];if(!g||(!gestor(req.cuenta)&&g.solicitado_por!==req.cuenta.id))return res.status(404).json({mensaje:'Guía no disponible.'});
   const [detalles]=await db.execute(`SELECT x.sobrante_id,x.entregada,x.motivo_faltante,a.codigo_lote,a.codigo,a.descripcion,a.unidad FROM despacho_detalles x JOIN solicitud_detalles a ON a.solicitud_id=? AND a.sobrante_id=x.sobrante_id WHERE x.despacho_id=? AND x.entregada>0 ORDER BY a.codigo_lote`,[g.solicitud_id,g.id]);
   if(!detalles.length)return res.status(404).json({mensaje:'Este despacho no tiene materiales entregados.'});
   delete g.solicitado_por;
   res.json({guia:{...g,codigo:codigo('GUI',g.numero),despacho:codigo('DES',g.numero),solicitud:codigo('SOL',g.solicitud_numero)},detalles});
  }catch(e){console.error('Detalle guía:',e.code);res.status(500).json({mensaje:'No se pudo consultar la guía.'});}
 });return router;
};
