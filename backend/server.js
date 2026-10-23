const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
if (!process.env.JWT_SECRET) {
  throw new Error('Falta configurar JWT_SECRET en las variables de entorno.');
}
const app = express();
const PORT = Number(process.env.PORT || 3000);
const origenesPermitidos = (process.env.FRONTEND_URL || '')
  .split(',').map((origen) => origen.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  origenesPermitidos.push('http://localhost:8100', 'http://localhost:8101');
}
app.use(cors({
  origin: (origen, callback) => {
    callback(null, !origen || origenesPermitidos.includes(origen));
  },
}));
app.use(express.json({ limit: '100kb' }));
// Conecta las rutas de recuperación de contraseña.
app.use('/api', require('./recuperacion'));
async function obtenerRoles(usuarioId, conexion = db) {
  const [roles] = await conexion.execute(
    `SELECT r.nombre
     FROM roles r
     JOIN usuario_roles ur ON ur.rol_id = r.id
     WHERE ur.usuario_id = ?
     ORDER BY r.nombre`,
    [usuarioId]
  );
  return roles.map((rol) => rol.nombre);
}
function datosPublicos(cuenta, roles) {
  return {
    id: cuenta.id,
    nombre: cuenta.nombre,
    usuario: cuenta.usuario,
    correo: cuenta.correo,
    roles,
  };
}
async function comprobarSesion(req, res, next) {
  const autorizacion = req.headers.authorization;
  if (!autorizacion?.startsWith('Bearer ')) {
    return res.status(401).json({
      mensaje: 'Debes iniciar sesión.',
    });
  }
  let datos;
  try {
    datos = jwt.verify(
      autorizacion.slice(7),
      process.env.JWT_SECRET,
      { algorithms: ['HS256'] }
    );
    if (
      typeof datos !== 'object' ||
      typeof datos.sub !== 'string' ||
      !datos.sub
    ) {
      throw new Error('Token sin usuario');
    }
  } catch {
    return res.status(401).json({
      mensaje: 'La sesión venció o no es válida.',
    });
  }
  try {
    const [usuarios] = await db.execute(
      `SELECT id, nombre, usuario, correo, version_sesion
       FROM usuarios
       WHERE id = ?
         AND activo = 1
         AND estado_cuenta = 'aprobada'
       LIMIT 1`,
      [datos.sub]
    );
    if (!usuarios.length) {
      return res.status(401).json({
        mensaje: 'La cuenta no está disponible.',
      });
    }
    const cuenta = usuarios[0];
// Los tokens anteriores a este cambio equivalen a versión 0.
    if ((datos.version_sesion ?? 0) !== cuenta.version_sesion) {
      return res.status(401).json({
        mensaje: 'La contraseña cambió. Inicia sesión nuevamente.',
      });
    }
    const roles = await obtenerRoles(cuenta.id);
    req.cuenta = datosPublicos(cuenta, roles);
    next();
  } catch (error) {
    console.error('Error en sesión:', error.code);
    return res.status(500).json({
      mensaje: 'No se pudo comprobar la sesión.',
    });
  }
}
function permitirRolSistema(req, res, next) {
  const permitidos = ['administrador', 'supervisor', 'bodega', 'colaborador'];
  if (!req.cuenta?.roles?.some((rol) => permitidos.includes(rol))) {
    return res.status(403).json({ mensaje: 'Tu cuenta no tiene un rol autorizado.' });
  }
  next();
}
function soloAdministrador(req, res, next) {
  if (!req.cuenta.roles.includes('administrador')) {
    return res.status(403).json({
      mensaje: 'Esta acción requiere permisos de administrador.',
    });
  }
  next();
}
app.get('/api/estado', (req, res) => {
  res.json({
    mensaje: 'El backend está funcionando.',
  });
});
app.post('/api/registro', async (req, res) => {
  const { nombre, usuario, correo, contrasena } = req.body || {};
  if (
    typeof nombre !== 'string' ||
    typeof usuario !== 'string' ||
    typeof correo !== 'string' ||
    typeof contrasena !== 'string'
  ) {
    return res.status(400).json({
      mensaje: 'Completa todos los campos.',
    });
  }
  const nombreLimpio = nombre.trim();
  const usuarioLimpio = usuario.trim();
  const correoLimpio = correo.trim().toLowerCase();
  if (
    nombreLimpio.length < 2 ||
    nombreLimpio.length > 100 ||
    !/^[a-zA-Z0-9._-]{3,50}$/.test(usuarioLimpio) ||
    correoLimpio.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)
  ) {
    return res.status(400).json({
      mensaje:
        'Revisa el nombre y correo. El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo.',
    });
  }
  if (
    contrasena.length < 12 ||
    Buffer.byteLength(contrasena, 'utf8') > 72
  ) {
    return res.status(400).json({
      mensaje:
        'Usa una contraseña de al menos 12 caracteres y como máximo 72 bytes.',
    });
  }
  try {
    const passwordHash = await bcrypt.hash(contrasena, 12);
    await db.execute(
      `INSERT INTO usuarios
       (
         id, nombre, usuario, correo,
         password_hash, activo, estado_cuenta
       )
       VALUES (?, ?, ?, ?, ?, 0, 'pendiente')`,
      [
        randomUUID(),
        nombreLimpio,
        usuarioLimpio,
        correoLimpio,
        passwordHash,
      ]
    );
    return res.status(201).json({
      mensaje:
        'Cuenta registrada. Un administrador debe aprobar tu acceso.',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        mensaje: 'No se pudo registrar ese usuario o correo.',
      });
    }
    console.error('Error en registro:', error.code);
    return res.status(500).json({
      mensaje: 'No se pudo registrar la cuenta.',
    });
  }
});
app.post('/api/login', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body || {};
    if (
      typeof usuario !== 'string' ||
      typeof contrasena !== 'string' ||
      !usuario.trim() ||
      !contrasena
    ) {
      return res.status(400).json({
        mensaje: 'Completa el usuario y la contraseña.',
      });
    }
    const [usuarios] = await db.execute(
      `SELECT
         id, nombre, usuario, correo,
         password_hash, activo, estado_cuenta, version_sesion
       FROM usuarios
       WHERE usuario = ?
       LIMIT 1`,
      [usuario.trim()]
    );
    const cuenta = usuarios[0];
    if (!cuenta) {
      return res.status(401).json({
        mensaje: 'Usuario o contraseña incorrectos.',
      });
    }
    const correcta = await bcrypt.compare(
      contrasena,
      cuenta.password_hash
    );
    if (!correcta) {
      return res.status(401).json({
        mensaje: 'Usuario o contraseña incorrectos.',
      });
    }
    if (cuenta.estado_cuenta === 'pendiente') {
      return res.status(403).json({
        mensaje: 'Tu cuenta está pendiente de aprobación.',
      });
    }
    if (
      !cuenta.activo ||
      cuenta.estado_cuenta !== 'aprobada'
    ) {
      return res.status(403).json({
        mensaje: 'Tu cuenta no tiene el acceso habilitado.',
      });
    }
    const roles = await obtenerRoles(cuenta.id);
    const token = jwt.sign(
      { version_sesion: cuenta.version_sesion },
      process.env.JWT_SECRET,
      {
        subject: String(cuenta.id),
        expiresIn: '1h',
        algorithm: 'HS256',
      }
    );
    return res.json({
      mensaje: 'Credenciales correctas.',
      token,
      usuario: datosPublicos(cuenta, roles),
    });
  } catch (error) {
    console.error('Error en login:', error.code);
    return res.status(500).json({
      mensaje: 'No se pudo comprobar el inicio de sesión.',
    });
  }
});
app.get('/api/sesion', comprobarSesion, (req, res) => {
  res.json({
    usuario: req.cuenta,
  });
});
app.get(
  '/api/admin/usuarios/pendientes',
  comprobarSesion,
  soloAdministrador,
  async (req, res) => {
    try {
      const [usuarios] = await db.execute(
        `SELECT id, nombre, usuario, correo, creado_en
         FROM usuarios
         WHERE estado_cuenta = 'pendiente'
         ORDER BY creado_en ASC`
      );
      res.json({ usuarios });
    } catch (error) {
      console.error('Error en pendientes:', error.code);
      res.status(500).json({
        mensaje: 'No se pudieron consultar las cuentas.',
      });
    }
  }
);
app.post(
  '/api/admin/usuarios/:id/aprobar',
  comprobarSesion,
  soloAdministrador,
  async (req, res) => {
    const rolesSolicitados = req.body?.roles;
    const permitidos = [
      'administrador',
      'supervisor',
      'bodega',
      'colaborador',
    ];
    if (
      !Array.isArray(rolesSolicitados) ||
      !rolesSolicitados.length ||
      rolesSolicitados.length > permitidos.length ||
      !rolesSolicitados.every((rol) => permitidos.includes(rol))
    ) {
      return res.status(400).json({
        mensaje: 'Selecciona al menos un rol válido.',
      });
    }
    const rolesUnicos = [...new Set(rolesSolicitados)];
    let conexion;
    try {
      conexion = await db.getConnection();
      await conexion.beginTransaction();
      const [usuarios] = await conexion.execute(
        `SELECT id, estado_cuenta
         FROM usuarios
         WHERE id = ?
         FOR UPDATE`,
        [req.params.id]
      );
      if (!usuarios.length) {
        await conexion.rollback();
        return res.status(404).json({
          mensaje: 'No se encontró la cuenta.',
        });
      }
      if (usuarios[0].estado_cuenta !== 'pendiente') {
        await conexion.rollback();
        return res.status(409).json({
          mensaje: 'La cuenta ya no está pendiente.',
        });
      }
      for (const nombreRol of rolesUnicos) {
        const [roles] = await conexion.execute(
          'SELECT id FROM roles WHERE nombre = ?',
          [nombreRol]
        );
        if (!roles.length) {
          throw new Error('Rol no configurado');
        }
        await conexion.execute(
          `INSERT INTO usuario_roles (usuario_id, rol_id)
           VALUES (?, ?)`,
          [req.params.id, roles[0].id]
        );
      }
      await conexion.execute(
        `UPDATE usuarios
         SET estado_cuenta = 'aprobada', activo = 1
         WHERE id = ?`,
        [req.params.id]
      );
      await conexion.commit();
      return res.json({
        mensaje: 'Cuenta aprobada y roles asignados.',
      });
    } catch (error) {
      if (conexion) {
        await conexion.rollback();
      }
      console.error('Error en aprobación:', error.code);
      return res.status(500).json({
        mensaje: 'No se pudo aprobar la cuenta.',
      });
    } finally {
      if (conexion) {
        conexion.release();
      }
    }
  }
);
// Catálogo: disponible para cualquier cuenta aprobada con sesión válida.
function filtrosCatalogo(query) {
  const filtros = {};
  for (const [clave, maximo] of [['familia', 20], ['tipo', 200], ['buscar', 200]]) {
    if (query[clave] !== undefined &&
        (typeof query[clave] !== 'string' || query[clave].length > maximo)) {
      throw new Error('Filtros inválidos');
    }
    filtros[clave] = (query[clave] || '').trim();
  }
  return filtros;
}
app.get('/api/catalogo/familias', comprobarSesion, permitirRolSistema, async (req, res) => {
  try {
    const [familias] = await db.execute(
      `SELECT f.id, f.codigo, f.nombre, COUNT(c.id) AS total_materiales
       FROM familias_materiales f
       LEFT JOIN catalogo_materiales c ON c.familia_id = f.id AND c.activo = 1
       WHERE f.activo = 1
       GROUP BY f.id, f.codigo, f.nombre
       ORDER BY f.nombre`
    );
    return res.json({ familias });
  } catch (error) {
    console.error('Error en familias:', error.code);
    return res.status(500).json({ mensaje: 'No se pudieron consultar las familias.' });
  }
});
app.get('/api/catalogo/tipos', comprobarSesion, permitirRolSistema, async (req, res) => {
  let filtros;
  try { filtros = filtrosCatalogo(req.query); }
  catch { return res.status(400).json({ mensaje: 'Revisa los filtros de búsqueda.' }); }
  try {
    const condiciones = ['c.activo = 1', 'f.activo = 1'];
    const parametros = [];
    if (filtros.familia) {
      condiciones.push('f.codigo = ?');
      parametros.push(filtros.familia);
    }
    const [tipos] = await db.execute(
      `SELECT DISTINCT c.tipo
       FROM catalogo_materiales c
       JOIN familias_materiales f ON f.id = c.familia_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY c.tipo`, parametros
    );
    return res.json({ tipos: tipos.map((fila) => fila.tipo) });
  } catch (error) {
    console.error('Error en tipos:', error.code);
    return res.status(500).json({ mensaje: 'No se pudieron consultar los tipos.' });
  }
});
app.get('/api/catalogo/materiales', comprobarSesion, permitirRolSistema, async (req, res) => {
  let filtros;
  const paginaTexto = req.query.pagina ?? '1';
  if (typeof paginaTexto !== 'string' || !/^[1-9][0-9]{0,5}$/.test(paginaTexto)) {
    return res.status(400).json({ mensaje: 'La página debe ser un número entero positivo.' });
  }
  try { filtros = filtrosCatalogo(req.query); }
  catch { return res.status(400).json({ mensaje: 'Revisa los filtros de búsqueda.' }); }
  const pagina = Number(paginaTexto);
  const porPagina = 50;
  const desplazamiento = (pagina - 1) * porPagina;
  try {
    const condiciones = ['c.activo = 1', 'f.activo = 1'];
    const parametros = [];
    if (filtros.familia) {
      condiciones.push('f.codigo = ?');
      parametros.push(filtros.familia);
    }
    if (filtros.tipo) {
      condiciones.push('c.tipo = ?');
      parametros.push(filtros.tipo);
    }
    if (filtros.buscar) {
// LOCATE busca texto literal, incluso si contiene % o _.
      condiciones.push('(LOCATE(?, c.codigo) > 0 OR LOCATE(?, c.descripcion) > 0)');
      parametros.push(filtros.buscar, filtros.buscar);
    }
    const consulta = `FROM catalogo_materiales c
      JOIN familias_materiales f ON f.id = c.familia_id
      WHERE ${condiciones.join(' AND ')}`;
    const [conteo] = await db.execute(`SELECT COUNT(*) AS total ${consulta}`, parametros);
    const [materiales] = await db.execute(
      `SELECT c.id, c.codigo, f.codigo AS familia_codigo,
              f.nombre AS familia, c.tipo, c.descripcion, c.estado_catalogo
       ${consulta}
       ORDER BY c.codigo
       LIMIT ${porPagina} OFFSET ${desplazamiento}`, parametros
    );
    const total = Number(conteo[0].total);
    return res.json({ materiales, total, pagina, porPagina, totalPaginas: Math.ceil(total / porPagina) });
  } catch (error) {
    console.error('Error en materiales:', error.code);
    return res.status(500).json({ mensaje: 'No se pudieron consultar los materiales.' });
  }
});
app.get(
  '/api/ubicaciones',
  comprobarSesion,
  permitirRolSistema,
  async (req, res) => {
    try {
      const [ubicaciones] = await db.execute(
        `SELECT id, codigo, zona, ubicacion, nombre, temporal
         FROM ubicaciones
         WHERE activo = 1
         ORDER BY temporal DESC, zona, ubicacion`
      );
      return res.json({ ubicaciones });
    } catch (error) {
      console.error('Error al consultar ubicaciones:', error.code);
      return res.status(500).json({
        mensaje: 'No se pudieron consultar las ubicaciones.',
      });
    }
  }
);
app.get(
  '/api/catalogo/materiales/:id/unidades',
  comprobarSesion,
  permitirRolSistema,
  async (req, res) => {
    const id = req.params.id;
    if (
      !/^[1-9][0-9]{0,9}$/.test(id) ||
      Number(id) > 4294967295
    ) {
      return res.status(400).json({
        mensaje: 'El material seleccionado no es válido.',
      });
    }
    try {
      const [materiales] = await db.execute(
        `SELECT c.id
         FROM catalogo_materiales c
         JOIN familias_materiales f ON f.id = c.familia_id
         WHERE c.id = ? AND c.activo = 1 AND f.activo = 1`,
        [id]
      );
      if (!materiales.length) {
        return res.status(404).json({
          mensaje: 'El material no está disponible.',
        });
      }
      const [filas] = await db.execute(
        `SELECT unidad
         FROM material_unidades
         WHERE material_id = ?
         ORDER BY unidad`,
        [id]
      );
      return res.json({
        unidades: filas.map((fila) => fila.unidad),
      });
    } catch (error) {
      console.error('Error al consultar unidades:', error.code);
      return res.status(500).json({
        mensaje: 'No se pudieron consultar las unidades del material.',
      });
    }
  }
);
app.use('/api/sobrantes', require('./sobrantes')(comprobarSesion));
app.use('/api/solicitudes', require('./solicitudes')(comprobarSesion));
app.use('/api/despachos', require('./despachos')(comprobarSesion));
app.use('/api/guias', require('./guias')(comprobarSesion));
// Las rutas API inexistentes nunca deben devolver el HTML del frontend.
app.use('/api', (req, res) => {
  res.status(404).json({ mensaje: 'Ruta de API no encontrada.' });
});
const carpetaFrontend = path.resolve(__dirname, '../frontend/www');
if (fs.existsSync(path.join(carpetaFrontend, 'index.html'))) {
  app.use(express.static(carpetaFrontend, { index: false }));
  app.get('/{*ruta}', (req, res, next) => {
    if (!req.accepts('html') || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(carpetaFrontend, 'index.html'));
  });
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});