const express = require('express');
const { randomUUID } = require('node:crypto');
const db = require('./db');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const roles = ['administrador', 'supervisor', 'bodega', 'colaborador'];
const gestores = ['administrador', 'supervisor', 'bodega'];
const codigo = (prefijo, numero) => `${prefijo}-${String(numero).padStart(3, '0')}`;
const verTodas = cuenta => cuenta.roles.some(r => gestores.includes(r));
// Trabajar en milésimas enteras evita redondear decimales de inventario.
function milesimas(valor) {
  const s = String(valor);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(s)) return null;
  const [entero, decimal = ''] = s.split('.');
  const n = Number(entero) * 1000 + Number(decimal.padEnd(3, '0'));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function decimal(n) { return `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, '0')}`; }
const reservasSql = `LEFT JOIN (
  SELECT d.sobrante_id, SUM(d.cantidad) AS reservada
  FROM solicitud_detalles d JOIN solicitudes p ON p.id = d.solicitud_id
  WHERE p.estado IN ('enviada', 'aprobada') GROUP BY d.sobrante_id
) r ON r.sobrante_id = s.id`;
const catalogoSql = `FROM sobrantes s
  JOIN catalogo_materiales c ON c.id = s.material_id
  JOIN familias_materiales f ON f.id = c.familia_id
  LEFT JOIN ubicaciones l ON l.id = s.ubicacion_id
  ${reservasSql}`;
const condicionBase = `s.estado = 'aprobado' AND c.activo = 1 AND f.activo = 1
  AND s.cantidad > COALESCE(r.reservada, 0)`;
function fallo(mensaje, status = 400) { return Object.assign(new Error(mensaje), { status }); }

module.exports = function crearRutasSolicitudes(comprobarSesion) {
  const router = express.Router();
  router.use(comprobarSesion);
  router.use((req, res, next) => {
    if (!req.cuenta?.roles?.some(r => roles.includes(r))) {
      return res.status(403).json({ mensaje: 'Tu cuenta no tiene un rol autorizado.' });
    }
    next();
  });
  router.get('/filtros', async (req, res) => {
    try {
      const [opciones] = await db.execute(`SELECT DISTINCT f.id AS familia_id,
        f.nombre AS familia, c.tipo ${catalogoSql} WHERE ${condicionBase}
        ORDER BY f.nombre, c.tipo`);
      return res.json({ opciones });
    } catch (e) {
      console.error('Filtros de solicitudes:', e.code);
      return res.status(500).json({ mensaje: 'No se pudieron cargar los filtros.' });
    }
  });
  router.get('/disponibles', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const familia = typeof req.query.familia === 'string' ? req.query.familia : '';
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo : '';
    const pagina = Number(req.query.pagina || 1);
    if (q.length > 200 || tipo.length > 200 ||
      (familia && !/^[1-9]\d{0,9}$/.test(familia)) ||
      !Number.isInteger(pagina) || pagina < 1 || pagina > 100000) {
      return res.status(400).json({ mensaje: 'Revisa los filtros de búsqueda.' });
    }
    const condiciones = [condicionBase];
    const valores = [];
    if (q) {
      condiciones.push('(LOCATE(?, c.codigo) > 0 OR LOCATE(?, c.descripcion) > 0)');
      valores.push(q, q);
    }
    if (familia) { condiciones.push('f.id = ?'); valores.push(familia); }
    if (tipo) { condiciones.push('c.tipo = ?'); valores.push(tipo); }
    const where = `WHERE ${condiciones.join(' AND ')}`;
    try {
      const [[conteo]] = await db.execute(`SELECT COUNT(*) AS total ${catalogoSql} ${where}`, valores);
      const [sobrantes] = await db.execute(`SELECT s.id, s.numero_lote, c.codigo,
        c.descripcion, f.nombre AS familia, c.tipo, s.unidad,
        s.cantidad - COALESCE(r.reservada, 0) AS disponible,
        COALESCE(l.nombre, s.ubicacion) AS ubicacion, s.foto_nombre
        ${catalogoSql} ${where} ORDER BY s.creado_en DESC, s.id LIMIT 12 OFFSET ${12 * (pagina - 1)}`, valores);
      return res.json({
        sobrantes: sobrantes.map(s => ({ ...s, codigo_lote: codigo('SOB', s.numero_lote) })),
        total: Number(conteo.total), pagina,
      });
    } catch (e) {
      console.error('Disponibles de solicitudes:', e.code);
      return res.status(500).json({ mensaje: 'No se pudieron consultar los sobrantes disponibles.' });
    }
  });
  router.get('/', async (req, res) => {
    const pagina = Number(req.query.pagina || 1);
    if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000) {
      return res.status(400).json({ mensaje: 'Página inválida.' });
    }
    const todas = verTodas(req.cuenta);
    const where = todas ? '' : 'WHERE p.solicitado_por = ?';
    const parametros = todas ? [] : [req.cuenta.id];
    try {
      const [[conteo]] = await db.execute(`SELECT COUNT(*) AS total FROM solicitudes p ${where}`, parametros);
      const [solicitudes] = await db.execute(`SELECT p.id, p.numero, p.solicitado_por,
        p.proyecto, p.observaciones, p.estado, p.creado_en, u.nombre AS solicitante,
        (SELECT COUNT(*) FROM solicitud_detalles d WHERE d.solicitud_id = p.id) AS lotes
        FROM solicitudes p JOIN usuarios u ON u.id = p.solicitado_por ${where}
        ORDER BY p.creado_en DESC, p.numero DESC LIMIT 20 OFFSET ${20 * (pagina - 1)}`, parametros);
      return res.json({ solicitudes: solicitudes.map(s => ({ ...s, codigo: codigo('SOL', s.numero) })),
        total: Number(conteo.total), pagina, puede_ver_todas: todas, usuario_id: req.cuenta.id });
    } catch (e) {
      console.error('Listado de solicitudes:', e.code);
      return res.status(500).json({ mensaje: 'No se pudieron consultar las solicitudes.' });
    }
  });
  // Esta autorización se comprueba en el servidor en cada operación.
  const puedeAprobar = cuenta => cuenta.roles.some(r => ['administrador', 'supervisor'].includes(r));
  router.get('/aprobaciones', async (req, res) => {
    if (!puedeAprobar(req.cuenta)) return res.status(403).json({ mensaje: 'Solo supervisores y administradores pueden revisar solicitudes.' });
    const pagina = Number(req.query.pagina || 1);
    if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000) return res.status(400).json({ mensaje: 'Página inválida.' });
    try {
      const [[conteo]] = await db.execute("SELECT COUNT(*) AS total FROM solicitudes WHERE estado = 'enviada'");
      const [solicitudes] = await db.execute(`SELECT p.id, p.numero, p.proyecto, p.creado_en,
        u.nombre AS solicitante FROM solicitudes p JOIN usuarios u ON u.id = p.solicitado_por
        WHERE p.estado = 'enviada' ORDER BY p.creado_en, p.numero LIMIT 20 OFFSET ${20 * (pagina - 1)}`);
      return res.json({ solicitudes: solicitudes.map(s => ({ ...s, codigo: codigo('SOL', s.numero) })), total: Number(conteo.total) });
    } catch (e) {
      console.error('Aprobaciones:', e.code);
      return res.status(500).json({ mensaje: 'No se pudieron cargar las aprobaciones.' });
    }
  });
  router.patch('/:id/aprobar', async (req, res) => {
    if (!puedeAprobar(req.cuenta)) return res.status(403).json({ mensaje: 'No tienes permiso para aprobar solicitudes.' });
    if (!uuid.test(req.params.id)) return res.status(400).json({ mensaje: 'Solicitud inválida.' });
    let cx;
    try {
      cx = await db.getConnection();
      await cx.beginTransaction();
      const [filas] = await cx.execute('SELECT id, estado FROM solicitudes WHERE id = ? FOR UPDATE', [req.params.id]);
      const s = filas[0];
      if (!s) throw fallo('Solicitud no disponible.', 404);
      if (s.estado === 'aprobada') {
        await cx.commit();
        return res.json({ mensaje: 'La solicitud ya está aprobada.' });
      }
      if (s.estado !== 'enviada') throw fallo('Esta solicitud ya no está pendiente de aprobación.', 409);
      // La reserva sigue activa: aprobar no descuenta ni libera inventario.
      await cx.execute("UPDATE solicitudes SET estado = 'aprobada' WHERE id = ?", [s.id]);
      await cx.execute('INSERT INTO solicitud_aprobaciones (solicitud_id, aprobado_por) VALUES (?, ?)', [s.id, req.cuenta.id]);
      await cx.commit();
      return res.json({ mensaje: 'Solicitud aprobada. Los materiales siguen reservados para el alistamiento.' });
    } catch (e) {
      if (cx) await cx.rollback().catch(() => {});
      console.error('Aprobar solicitud:', e.code || e.status);
      return res.status(e.status || 500).json({ mensaje: e.status ? e.message : 'No se pudo confirmar la aprobación. Actualiza antes de reintentar.' });
    } finally { if (cx) cx.release(); }
  });

  router.get('/:id', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ mensaje: 'Solicitud inválida.' });
    try {
      const [filas] = await db.execute(`SELECT p.*, u.nombre AS solicitante
        FROM solicitudes p JOIN usuarios u ON u.id = p.solicitado_por WHERE p.id = ?`, [req.params.id]);
      const s = filas[0];
      if (!s || (!verTodas(req.cuenta) && s.solicitado_por !== req.cuenta.id)) {
        return res.status(404).json({ mensaje: 'Solicitud no disponible.' });
      }
      const [detalles] = await db.execute(`SELECT sobrante_id, codigo, codigo_lote,
        descripcion, ubicacion, cantidad, unidad FROM solicitud_detalles WHERE solicitud_id = ?
        ORDER BY codigo_lote`, [s.id]);
      delete s.clave_envio;
      return res.json({ solicitud: { ...s, codigo: codigo('SOL', s.numero) }, detalles });
    } catch (e) {
      console.error('Detalle de solicitud:', e.code);
      return res.status(500).json({ mensaje: 'No se pudo consultar la solicitud.' });
    }
  });
  router.post('/', async (req, res) => {
    const { articulos, proyecto = '', observaciones = '', clave_envio } = req.body || {};
    if (!uuid.test(clave_envio || '') || typeof proyecto !== 'string' || proyecto.length > 200 ||
      typeof observaciones !== 'string' || observaciones.length > 1000 ||
      !Array.isArray(articulos) || !articulos.length || articulos.length > 50) {
      return res.status(400).json({ mensaje: 'Revisa los datos y agrega entre 1 y 50 lotes.' });
    }
    const items = articulos.map(a => ({ id: a?.sobrante_id, cantidad: milesimas(a?.cantidad) }));
    if (items.some(a => !uuid.test(a.id || '') || a.cantidad === null) ||
      new Set(items.map(a => a.id)).size !== items.length) {
      return res.status(400).json({ mensaje: 'Revisa los lotes y las cantidades; se admiten hasta tres decimales.' });
    }
    items.sort((a, b) => a.id.localeCompare(b.id));
    let cx;
    try {
      cx = await db.getConnection();
      // Serializa los envíos de esta cuenta y permite reintentar sin duplicados.
      await cx.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await cx.beginTransaction();
      await cx.execute('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [req.cuenta.id]);
      const [anteriores] = await cx.execute(`SELECT id, numero FROM solicitudes
        WHERE solicitado_por = ? AND clave_envio = ?`, [req.cuenta.id, clave_envio]);
      if (anteriores.length) {
        await cx.commit();
        return res.json({ id: anteriores[0].id, codigo: codigo('SOL', anteriores[0].numero),
          mensaje: 'Esta solicitud ya estaba registrada.' });
      }
      const lineas = [];
      // Todos los envíos bloquean los lotes en el mismo orden.
      for (const item of items) {
        const [filas] = await cx.execute(`SELECT id, estado, cantidad, material_id, unidad,
          numero_lote, ubicacion FROM sobrantes WHERE id = ? FOR UPDATE`, [item.id]);
        const lote = filas[0];
        if (!lote || lote.estado !== 'aprobado' || !lote.material_id) {
          throw fallo('Un lote ya no está aprobado o disponible. Actualiza el catálogo.', 409);
        }
        const [materiales] = await cx.execute(`SELECT c.codigo, c.descripcion FROM catalogo_materiales c
          JOIN familias_materiales f ON f.id = c.familia_id
          WHERE c.id = ? AND c.activo = 1 AND f.activo = 1`, [lote.material_id]);
        if (!materiales.length) throw fallo('Un material ya no está disponible.', 409);
        const [[r]] = await cx.execute(`SELECT COALESCE(SUM(d.cantidad), 0) AS reservada
          FROM solicitud_detalles d JOIN solicitudes p ON p.id = d.solicitud_id
          WHERE d.sobrante_id = ? AND p.estado IN ('enviada', 'aprobada')`, [item.id]);
        const total = milesimas(lote.cantidad);
        const reserva = Number(r.reservada) === 0 ? 0 : milesimas(r.reservada);
        if (total === null || reserva === null || item.cantidad > total - reserva) {
          throw fallo(`No hay suficiente cantidad en ${codigo('SOB', lote.numero_lote)}. Actualiza el catálogo.`, 409);
        }
        lineas.push({ ...item, ...materiales[0], unidad: lote.unidad,
          ubicacion: lote.ubicacion, codigo_lote: codigo('SOB', lote.numero_lote) });
      }
      const id = randomUUID();
      await cx.execute(`INSERT INTO solicitudes (id, solicitado_por, clave_envio, proyecto, observaciones)
        VALUES (?, ?, ?, ?, ?)`, [id, req.cuenta.id, clave_envio, proyecto.trim(), observaciones.trim()]);
      for (const item of lineas) {
        await cx.execute(`INSERT INTO solicitud_detalles
          (solicitud_id, sobrante_id, cantidad, unidad, codigo, descripcion, ubicacion, codigo_lote)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.id, decimal(item.cantidad), item.unidad, item.codigo, item.descripcion, item.ubicacion, item.codigo_lote]);
      }
      const [[s]] = await cx.execute('SELECT numero FROM solicitudes WHERE id = ?', [id]);
      await cx.commit();
      return res.status(201).json({ id, codigo: codigo('SOL', s.numero), mensaje: 'Solicitud enviada. Los materiales quedaron reservados.' });
    } catch (e) {
      if (cx) await cx.rollback().catch(() => {});
      console.error('Crear solicitud:', e.code || e.status);
      return res.status(e.status || 500).json({ mensaje: e.status ? e.message : 'No se confirmó el envío. Reintenta con la misma solicitud.' });
    } finally { if (cx) cx.release(); }
  });
  router.patch('/:id/cancelar', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ mensaje: 'Solicitud inválida.' });
    let cx;
    try {
      cx = await db.getConnection();
      await cx.beginTransaction();
      const [filas] = await cx.execute('SELECT * FROM solicitudes WHERE id = ? FOR UPDATE', [req.params.id]);
      const s = filas[0];
      if (!s || (s.solicitado_por !== req.cuenta.id && !req.cuenta.roles.includes('administrador'))) {
        throw fallo('No puedes cancelar esta solicitud.', 403);
      }
      if (!['enviada', 'cancelada'].includes(s.estado)) throw fallo('Una solicitud aprobada ya no se puede cancelar desde esta pantalla.', 409);
      if (s.estado !== 'cancelada') {
        await cx.execute("UPDATE solicitudes SET estado = 'cancelada', cancelado_en = UTC_TIMESTAMP() WHERE id = ?", [s.id]);
      }
      await cx.commit();
      return res.json({ mensaje: 'Solicitud cancelada. Se liberaron las cantidades reservadas.' });
    } catch (e) {
      if (cx) await cx.rollback().catch(() => {});
      return res.status(e.status || 500).json({ mensaje: e.status ? e.message : 'No se pudo cancelar la solicitud.' });
    } finally { if (cx) cx.release(); }
  });
  return router;
};
