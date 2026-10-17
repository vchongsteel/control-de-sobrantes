const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const db = require('./db');
const carpetaFotos = path.join(__dirname, 'uploads', 'sobrantes');
const rolesSistema = ['administrador', 'supervisor', 'bodega', 'colaborador'];
const estados = ['pendiente', 'aprobado', 'rechazado'];
function puedeRevisar(cuenta) {
  return cuenta.roles.some((rol) => ['administrador', 'supervisor'].includes(rol));
}
function soloRevisores(req, res, next) {
  if (!puedeRevisar(req.cuenta)) {
    return res.status(403).json({ mensaje: 'Solo administradores y supervisores pueden revisar sobrantes.' });
  }
  next();
}
function visibilidad(cuenta) {
  return puedeRevisar(cuenta)
    ? { sql: '1 = 1', parametros: [] }
    : { sql: "(s.estado = 'aprobado' OR s.registrado_por = ?)", parametros: [cuenta.id] };
}
const recibirFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 9, fieldSize: 10000, parts: 10 },
  fileFilter: (req, archivo, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.mimetype)) {
      return callback(new Error('TIPO_FOTO'));
    }
    callback(null, true);
  },
}).single('foto');
async function eliminarArchivo(ruta) {
  if (!ruta) return;
  try { await fs.unlink(ruta); }
  catch (error) {
    if (error.code !== 'ENOENT') console.error('Error al limpiar fotografía:', error.code);
  }
}

function idUbicacion(valor) {
  const texto = typeof valor === 'number' ? String(valor) : valor;
  if (typeof texto !== 'string' || !/^[1-9][0-9]{0,9}$/.test(texto) || Number(texto) > 4294967295) return null;
  return Number(texto);
}
function valorCompleto(valor) {
  if (valor === 1 || valor === '1' || valor === true) return 1;
  if (valor === 0 || valor === '0' || valor === false) return 0;
  return null;
}
async function comprobarUnidad(conexion, materialId, unidad) {
  if (!materialId) return '';
  const [permitidas] = await conexion.execute(
    'SELECT unidad FROM material_unidades WHERE material_id = ?', [materialId]
  );
  if (!permitidas.length) return 'Este material no tiene unidades configuradas. Consulta al supervisor o registra una descripción manual.';
  return permitidas.some((fila) => fila.unidad === unidad)
    ? '' : 'La unidad seleccionada no está permitida para este material.';
}

module.exports = function crearRutasSobrantes(comprobarSesion) {
  const router = express.Router();
  router.use(comprobarSesion);
  router.use((req, res, next) => {
    if (!req.cuenta?.roles?.some((rol) => rolesSistema.includes(rol))) {
      return res.status(403).json({ mensaje: 'Tu cuenta no tiene un rol autorizado.' });
    }
    next();
  });
  router.post('/', (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      return res.status(400).json({ mensaje: 'Envía los datos como formulario.' });
    }
    recibirFoto(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          mensaje: error.code === 'LIMIT_FILE_SIZE'
            ? 'La fotografía debe pesar como máximo 5 MB.'
            : error.message === 'TIPO_FOTO'
              ? 'Selecciona una fotografía JPG, PNG o WEBP.'
              : 'No se pudo recibir el formulario o la fotografía.',
        });
      }
      next();
    });
  }, async (req, res) => {
    const {
      material_id,
      descripcion_manual = '',
      cantidad,
      unidad,
      ubicacion_id, articulo_completo,
      observaciones = '',
    } = req.body || {};
    if (
      (material_id !== undefined && material_id !== null && typeof material_id !== 'string') ||
      typeof descripcion_manual !== 'string'
    ) {
      return res.status(400).json({ mensaje: 'Revisa la identificación del material.' });
    }
    const materialId = (material_id || '').trim();
    const descripcionManual = descripcion_manual.trim();
    const esManual = !materialId;
    if (esManual) {
      if (descripcionManual.length < 3 || descripcion_manual.length > 500) {
        return res.status(400).json({ mensaje: 'Describe el material con entre 3 y 500 caracteres.' });
      }
    } else if (
      !/^[1-9][0-9]{0,9}$/.test(materialId) || Number(materialId) > 4294967295 ||
      descripcionManual || descripcion_manual.length > 500
    ) {
      return res.status(400).json({ mensaje: 'Selecciona un material del catálogo o escribe una descripción manual, no ambos.' });
    }
    if (
      typeof cantidad !== 'string' ||
      !/^[0-9]{1,12}(\.[0-9]{1,3})?$/.test(cantidad) || Number(cantidad) < 0.001 ||
      !['unidades', 'kg', 'm', 'm2', 'm3', 'litros'].includes(unidad) ||
      typeof observaciones !== 'string' || observaciones.length > 1000
    ) {
      return res.status(400).json({ mensaje: 'Revisa el material, cantidad, unidad y ubicación. La cantidad admite hasta tres decimales.' });
    }
    const ubicacionId = idUbicacion(ubicacion_id);
    const completo = valorCompleto(articulo_completo);
    if (ubicacionId === null || completo === null) {
      return res.status(400).json({ mensaje: 'Selecciona una ubicación e indica si el artículo está completo: Sí o No.' });
    }
    let rutaFoto = null;
    let nombreFoto = null;
    try {
      const [lugares] = await db.execute(
        'SELECT id, nombre FROM ubicaciones WHERE id = ? AND activo = 1', [ubicacionId]
      );
      if (!lugares.length) return res.status(400).json({ mensaje: 'La ubicación seleccionada no está disponible.' });
      const ubicacion = lugares[0].nombre;
      const errorUnidad = await comprobarUnidad(db, materialId || null, unidad);
      if (errorUnidad) return res.status(400).json({ mensaje: errorUnidad });
      if (!esManual) {
        const [materiales] = await db.execute(
          `SELECT c.id FROM catalogo_materiales c
           JOIN familias_materiales f ON f.id = c.familia_id
           WHERE c.id = ? AND c.activo = 1 AND f.activo = 1 LIMIT 1`, [materialId]
        );
        if (!materiales.length) return res.status(400).json({ mensaje: 'El material no está disponible.' });
      }
      let imagenConvertida = null;
      if (req.file) {
        try {
          const imagen = sharp(req.file.buffer, { limitInputPixels: 25000000 });
          const datos = await imagen.metadata();
          if (!['jpeg', 'png', 'webp'].includes(datos.format) || (datos.pages || 1) > 1) {
            throw new Error('Imagen no permitida');
          }
          imagenConvertida = await imagen.rotate()
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 }).toBuffer();
        } catch {
          return res.status(400).json({ mensaje: 'La fotografía no es válida. Usa JPG, PNG o WEBP sin animación.' });
        }
      }
      const id = randomUUID();
      if (imagenConvertida) {
        await fs.mkdir(carpetaFotos, { recursive: true });
        nombreFoto = `${randomUUID()}.webp`;
        rutaFoto = path.join(carpetaFotos, nombreFoto);
        await fs.writeFile(rutaFoto, imagenConvertida, { flag: 'wx' });
      }
// Nunca se acepta estado ni usuario de aprobación desde el formulario.
      let resultado;
      if (esManual) {
        [resultado] = await db.execute(
          `INSERT INTO sobrantes
           (id, material_id, descripcion_manual, registrado_por, cantidad,
            unidad, ubicacion, ubicacion_id, articulo_completo, observaciones, foto_nombre, estado)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
          [id, descripcionManual, req.cuenta.id, cantidad, unidad,
            ubicacion, ubicacionId, completo, observaciones.trim(), nombreFoto]
        );
      } else {
        [resultado] = await db.execute(
          `INSERT INTO sobrantes
           (id, material_id, descripcion_manual, registrado_por, cantidad,
            unidad, ubicacion, ubicacion_id, articulo_completo, observaciones, foto_nombre, estado)
           SELECT ?, c.id, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente'
           FROM catalogo_materiales c
           JOIN familias_materiales f ON f.id = c.familia_id
           WHERE c.id = ? AND c.activo = 1 AND f.activo = 1`,
          [id, req.cuenta.id, cantidad, unidad, ubicacion, ubicacionId, completo,
            observaciones.trim(), nombreFoto, materialId]
        );
      }
      if (resultado.affectedRows !== 1) {
        await eliminarArchivo(rutaFoto);
        return res.status(400).json({ mensaje: 'El material ya no está disponible.' });
      }
      return res.status(201).json({
        mensaje: esManual
          ? 'Sobrante registrado con descripción manual. Está pendiente de identificación y revisión.'
          : 'Sobrante registrado. Está pendiente de aprobación por un administrador o supervisor.',
        id, codigo_lote: `SOB-${String(resultado.insertId).padStart(3, '0')}`, estado: 'pendiente',
        identificacion: esManual ? 'manual' : 'catalogo',
      });
    } catch (error) {
      await eliminarArchivo(rutaFoto);
      console.error('Error al guardar sobrante:', error.code);
      return res.status(500).json({ mensaje: 'No se pudo guardar el sobrante.' });
    }
  });
  router.get('/', async (req, res) => {
    const estado = req.query.estado;
    if (estado !== undefined && (typeof estado !== 'string' || !estados.includes(estado))) {
      return res.status(400).json({ mensaje: 'Estado de consulta inválido.' });
    }
    const acceso = visibilidad(req.cuenta);
    const condiciones = [acceso.sql];
    const parametros = [...acceso.parametros];
    if (estado) { condiciones.push('s.estado = ?'); parametros.push(estado); }
    try {
      const [sobrantes] = await db.execute(
        `SELECT s.id,
                CONCAT('SOB-', LPAD(CAST(s.numero_lote AS CHAR),
                  GREATEST(3, CHAR_LENGTH(s.numero_lote)), '0')) AS codigo_lote,
                s.material_id, s.descripcion_manual, s.version_datos,
                CASE WHEN s.material_id IS NULL THEN 'manual' ELSE 'catalogo' END AS identificacion,
                COALESCE(c.codigo, 'Sin código de catálogo') AS codigo,
                COALESCE(c.descripcion, s.descripcion_manual) AS descripcion,
                COALESCE(f.nombre, 'Por identificar') AS familia,
                COALESCE(c.tipo, 'Por identificar') AS tipo,
                s.cantidad, s.unidad, COALESCE(l.nombre, s.ubicacion) AS ubicacion,
                s.ubicacion_id, s.articulo_completo, s.observaciones,
                s.foto_nombre, s.creado_en, u.nombre AS registrado_por,
                s.estado,
                DATE_FORMAT(s.revisado_en, '%Y-%m-%dT%H:%i:%s.000Z') AS revisado_en,
                s.motivo_rechazo, r.nombre AS revisado_por
         FROM sobrantes s
         LEFT JOIN ubicaciones l ON l.id = s.ubicacion_id
         LEFT JOIN catalogo_materiales c ON c.id = s.material_id
         LEFT JOIN familias_materiales f ON f.id = c.familia_id
         JOIN usuarios u ON u.id = s.registrado_por
         LEFT JOIN usuarios r ON r.id = s.revisado_por
         WHERE ${condiciones.join(' AND ')}
         ORDER BY s.creado_en DESC, s.id DESC LIMIT 100`, parametros
      );
      return res.json({ sobrantes, puede_revisar: puedeRevisar(req.cuenta) });
    } catch (error) {
      console.error('Error al consultar sobrantes:', error.code);
      return res.status(500).json({ mensaje: 'No se pudieron consultar los sobrantes.' });
    }
  });
  // Corrige solo el lote pendiente. Nunca modifica el catálogo maestro.
  router.patch('/:id/datos', soloRevisores, async (req, res) => {
    const {
      material_id, descripcion_manual = '', cantidad, unidad,
      ubicacion, ubicacion_id, articulo_completo, observaciones = '', version_datos,
    } = req.body || {};
    if (!Number.isInteger(version_datos) || version_datos < 0 || version_datos > 4294967294) {
      return res.status(400).json({ mensaje: 'Actualiza la lista antes de corregir el sobrante.' });
    }
    const materialId = typeof material_id === 'number' ? String(material_id) : material_id;
    const cantidadTexto = typeof cantidad === 'number' ? String(cantidad) : cantidad;
    if (
      (materialId !== undefined && materialId !== null && typeof materialId !== 'string') ||
      typeof descripcion_manual !== 'string' || descripcion_manual.length > 500 ||
      typeof cantidadTexto !== 'string' || !/^[0-9]{1,12}(\.[0-9]{1,3})?$/.test(cantidadTexto) ||
      Number(cantidadTexto) < 0.001 || !['unidades', 'kg', 'm', 'm2', 'm3', 'litros'].includes(unidad) ||
      (ubicacion_id === undefined && (typeof ubicacion !== 'string' || !ubicacion.trim() || ubicacion.trim().length > 200)) ||
      typeof observaciones !== 'string' || observaciones.length > 1000
    ) {
      return res.status(400).json({ mensaje: 'Revisa la identificación, cantidad, unidad y ubicación. La cantidad admite hasta tres decimales.' });
    }
    const materialLimpio = (materialId || '').trim();
    const descripcionLimpia = descripcion_manual.trim();
    if ((materialLimpio && (!/^[1-9][0-9]{0,9}$/.test(materialLimpio) || Number(materialLimpio) > 4294967295)) ||
        (!materialLimpio && descripcionLimpia.length < 3)) {
      return res.status(400).json({ mensaje: 'Selecciona un material del catálogo o escribe una descripción manual válida.' });
    }
    let conexion;
    try {
      conexion = await db.getConnection();
      await conexion.beginTransaction();
      const [registros] = await conexion.execute(
        `SELECT id, material_id, descripcion_manual, estado, version_datos, ubicacion, ubicacion_id, articulo_completo
         FROM sobrantes WHERE id = ? FOR UPDATE`, [req.params.id]
      );
      const sobrante = registros[0];
      if (!sobrante) {
        await conexion.rollback();
        return res.status(404).json({ mensaje: 'No se encontró el sobrante.' });
      }
      if (sobrante.estado !== 'pendiente' || sobrante.version_datos !== version_datos) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió o ya fue revisado. Actualiza la lista antes de continuar.' });
      }
      if (materialLimpio) {
        const [materiales] = await conexion.execute(
          `SELECT c.id FROM catalogo_materiales c
           JOIN familias_materiales f ON f.id = c.familia_id
           WHERE c.id = ? AND c.activo = 1 AND f.activo = 1 FOR SHARE`, [materialLimpio]
        );
        if (!materiales.length) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'El material del catálogo no está disponible.' });
        }
      }
      let ubicacionId = sobrante.ubicacion_id;
      let ubicacionTexto = sobrante.ubicacion;
      let completo = sobrante.articulo_completo;
      if (articulo_completo !== undefined) {
        completo = valorCompleto(articulo_completo);
        if (completo === null) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'Indica si el artículo está completo: Sí o No.' });
        }
      }
      if (ubicacion_id !== undefined) {
        ubicacionId = idUbicacion(ubicacion_id);
        if (ubicacionId === null) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'Selecciona una ubicación válida.' });
        }
        const [lugares] = await conexion.execute(
          'SELECT id, nombre FROM ubicaciones WHERE id = ? AND activo = 1 FOR SHARE', [ubicacionId]
        );
        if (!lugares.length) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'La ubicación no está disponible.' });
        }
        ubicacionTexto = lugares[0].nombre;
      } else if (!ubicacionId) {
        // Compatibilidad para lotes antiguos que aún tienen ubicación escrita.
        ubicacionTexto = ubicacion.trim();
      } else if (ubicacion.trim() !== sobrante.ubicacion) {
        await conexion.rollback();
        return res.status(400).json({ mensaje: 'Esta ubicación se selecciona de la lista; actualiza la pantalla de edición.' });
      }
      const errorUnidad = await comprobarUnidad(conexion, materialLimpio || null, unidad);
      if (errorUnidad) {
        await conexion.rollback();
        return res.status(400).json({ mensaje: errorUnidad });
      }
      // Al vincular un registro manual, se conserva su descripción como referencia.
      const descripcionGuardada = materialLimpio
        ? (sobrante.descripcion_manual || descripcionLimpia || null)
        : descripcionLimpia;
      const [cambio] = await conexion.execute(
        `UPDATE sobrantes SET material_id = ?, descripcion_manual = ?, cantidad = ?, unidad = ?,
         ubicacion = ?, ubicacion_id = ?, articulo_completo = ?, observaciones = ?, version_datos = version_datos + 1
         WHERE id = ? AND estado = 'pendiente' AND version_datos = ?`,
        [materialLimpio || null, descripcionGuardada, cantidadTexto, unidad,
          ubicacionTexto, ubicacionId, completo, observaciones.trim(), req.params.id, version_datos]
      );
      if (cambio.affectedRows !== 1) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió. Actualiza la lista.' });
      }
      await conexion.commit();
      return res.json({ mensaje: 'Datos corregidos. El sobrante continúa pendiente de aprobación.', version_datos: version_datos + 1, ubicacion: ubicacionTexto, ubicacion_id: ubicacionId, articulo_completo: completo });
    } catch (error) {
      if (conexion) {
        try { await conexion.rollback(); } catch (rollbackError) { console.error('Error al deshacer corrección:', rollbackError.code); }
      }
      console.error('Error al corregir sobrante:', error.code);
      return res.status(500).json({ mensaje: 'No se pudo corregir el sobrante.' });
    } finally {
      if (conexion) conexion.release();
    }
  });
  router.patch('/:id/revision', soloRevisores, async (req, res) => {
    const { estado, motivo = '', version_datos } = req.body || {};
    if (!['aprobado', 'rechazado'].includes(estado) || typeof motivo !== 'string' ||
        motivo.length > 1000 || (estado === 'rechazado' && !motivo.trim())) {
      return res.status(400).json({ mensaje: 'Selecciona aprobar o rechazar. Para rechazar, escribe el motivo (hasta 1000 caracteres).' });
    }
    if (!Number.isInteger(version_datos) || version_datos < 0 || version_datos > 4294967294) {
      return res.status(400).json({ mensaje: 'Actualiza la pantalla de revisión antes de aprobar o rechazar.' });
    }
    let conexion;
    try {
      conexion = await db.getConnection();
      await conexion.beginTransaction();
      const [registros] = await conexion.execute(
        `SELECT id, estado, material_id, version_datos, unidad, ubicacion_id, articulo_completo FROM sobrantes WHERE id = ? FOR UPDATE`, [req.params.id]
      );
      const sobrante = registros[0];
      if (!sobrante) {
        await conexion.rollback();
        return res.status(404).json({ mensaje: 'No se encontró el sobrante.' });
      }
      if (sobrante.estado !== 'pendiente' || sobrante.version_datos !== version_datos) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió o ya fue revisado. Actualiza la lista.' });
      }
      if (estado === 'aprobado') {
        if (!sobrante.ubicacion_id || ![0, 1].includes(sobrante.articulo_completo)) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'Selecciona ubicación y completo Sí/No, y guarda antes de aprobar.' });
        }
        const errorUnidad = await comprobarUnidad(conexion, sobrante.material_id, sobrante.unidad);
        if (errorUnidad) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: errorUnidad });
        }

        if (!sobrante.material_id) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'Identifica el material y guarda los cambios antes de aprobarlo.' });
        }
        const [materiales] = await conexion.execute(
          `SELECT c.id FROM catalogo_materiales c
           JOIN familias_materiales f ON f.id = c.familia_id
           WHERE c.id = ? AND c.activo = 1 AND f.activo = 1 FOR SHARE`, [sobrante.material_id]
        );
        if (!materiales.length) {
          await conexion.rollback();
          return res.status(400).json({ mensaje: 'El material del catálogo no está disponible. Corrige su identificación.' });
        }
      }
      const [resultado] = await conexion.execute(
        `UPDATE sobrantes
         SET estado = ?, revisado_por = ?, revisado_en = UTC_TIMESTAMP(), motivo_rechazo = ?
         , version_datos = version_datos + 1
         WHERE id = ? AND estado = 'pendiente' AND version_datos = ?`,
        [estado, req.cuenta.id, estado === 'rechazado' ? motivo.trim() : null, req.params.id, version_datos]
      );
      if (resultado.affectedRows !== 1) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió. Actualiza la lista.' });
      }
      await conexion.commit();
      return res.json({ mensaje: estado === 'aprobado' ? 'Sobrante aprobado.' : 'Sobrante rechazado.', estado, version_datos: version_datos + 1 });
    } catch (error) {
      if (conexion) {
        try { await conexion.rollback(); } catch (rollbackError) { console.error('Error al deshacer revisión:', rollbackError.code); }
      }
      console.error('Error al revisar sobrante:', error.code);
      return res.status(500).json({ mensaje: 'No se pudo revisar el sobrante.' });
    } finally {
      if (conexion) conexion.release();
    }
  });
  router.get('/:id/foto', async (req, res) => {
    const acceso = visibilidad(req.cuenta);
    try {
      const [registros] = await db.execute(
        `SELECT s.foto_nombre FROM sobrantes s
         WHERE s.id = ? AND ${acceso.sql} LIMIT 1`, [req.params.id, ...acceso.parametros]
      );
      const nombre = registros[0]?.foto_nombre;
      if (!nombre || !/^[a-f0-9-]{36}\.webp$/.test(nombre)) {
        return res.status(404).json({ mensaje: 'No se encontró la fotografía.' });
      }
      const ruta = path.join(carpetaFotos, nombre);
      await fs.access(ruta);
      res.set('Cache-Control', 'private, no-store');
      return res.sendFile(ruta, (error) => {
        if (error && !res.headersSent) res.status(404).json({ mensaje: 'No se encontró la fotografía.' });
      });
    } catch (error) {
      return res.status(error.code === 'ENOENT' ? 404 : 500).json({ mensaje: 'No se pudo consultar la fotografía.' });
    }
  });
  router.delete('/:id', soloRevisores, async (req, res) => {
    const { version_datos } = req.body || {};
    if (!Number.isInteger(version_datos) || version_datos < 0 || version_datos > 4294967295) {
      return res.status(400).json({ mensaje: 'Actualiza la lista antes de eliminar.' });
    }
    let conexion;
    let nombreFoto;
    try {
      conexion = await db.getConnection();
      await conexion.beginTransaction();
      const [registros] = await conexion.execute(
        'SELECT id, version_datos, foto_nombre FROM sobrantes WHERE id = ? FOR UPDATE', [req.params.id]
      );
      const sobrante = registros[0];
      if (!sobrante) {
        await conexion.rollback();
        return res.status(404).json({ mensaje: 'No se encontró el sobrante. Actualiza la lista.' });
      }
      if (sobrante.version_datos !== version_datos) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió. Actualiza la lista.' });
      }
      const [resultado] = await conexion.execute(
        'DELETE FROM sobrantes WHERE id = ? AND version_datos = ?', [req.params.id, version_datos]
      );
      if (resultado.affectedRows !== 1) {
        await conexion.rollback();
        return res.status(409).json({ mensaje: 'El sobrante cambió. Actualiza la lista.' });
      }
      nombreFoto = sobrante.foto_nombre;
      await conexion.commit();
    } catch (error) {
      if (conexion) {
        try { await conexion.rollback(); } catch (e) { console.error('Error al deshacer eliminación:', e.code); }
      }
      console.error('Error al eliminar sobrante:', error.code);
      return res.status(error.code === 'ER_ROW_IS_REFERENCED_2' ? 409 : 500).json({
        mensaje: error.code === 'ER_ROW_IS_REFERENCED_2'
          ? 'El sobrante tiene registros relacionados y no se puede eliminar.' : 'No se pudo eliminar el sobrante.',
      });
    } finally {
      if (conexion) conexion.release();
    }
    if (typeof nombreFoto === 'string' && /^[a-f0-9-]{36}\.webp$/.test(nombreFoto)) {
      await eliminarArchivo(path.join(carpetaFotos, nombreFoto));
    }
    return res.json({ mensaje: 'Sobrante eliminado.' });
  });
  return router;
};
