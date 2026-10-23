const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { rateLimit } = require('express-rate-limit');
const {
  randomUUID,
  randomBytes,
  createHash,
} = require('node:crypto');
const db = require('./db');

const router = express.Router();

const limitar = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    mensaje:
      'Has realizado demasiados intentos. Espera 15 minutos.',
  },
});

const mensajeGeneral =
  'Si el correo corresponde a una cuenta habilitada, recibirás un enlace de recuperación. Revisa también el correo no deseado.';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function crearTransporte() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASSWORD,
    SMTP_FROM,
  } = process.env;

  if (
    !SMTP_HOST ||
    !SMTP_PORT ||
    !SMTP_USER ||
    !SMTP_PASSWORD ||
    !SMTP_FROM
  ) {
    return null;
  }

  const puerto = Number(SMTP_PORT);

  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    requireTLS: puerto !== 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
}

router.post('/recuperar-contrasena', limitar, async (req, res) => {
  const correo = req.body?.correo;

  if (
    typeof correo !== 'string' ||
    correo.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())
  ) {
    return res.status(400).json({
      mensaje: 'Escribe un correo válido.',
    });
  }

  const transporte = crearTransporte();

  if (!transporte) {
    return res.status(503).json({
      mensaje:
        'La recuperación por correo todavía no está configurada. Contacta al administrador.',
    });
  }

  let conexion;

  try {
    // Comprueba el servicio antes de consultar la cuenta.
    await transporte.verify();

    const [usuarios] = await db.execute(
      `SELECT id, correo
       FROM usuarios
       WHERE correo = ?
         AND activo = 1
         AND estado_cuenta = 'aprobada'
       LIMIT 1`,
      [correo.trim().toLowerCase()]
    );

    if (!usuarios.length) {
      return res.json({ mensaje: mensajeGeneral });
    }

    const cuenta = usuarios[0];
    const token = randomBytes(32).toString('hex');
    const recuperacionId = randomUUID();

    const base = process.env.FRONTEND_URL ||
      'http://localhost:8100';

    const enlace = new URL('/restablecer-contrasena', base);
    enlace.searchParams.set('token', token);

    conexion = await db.getConnection();
    await conexion.beginTransaction();

    const [cuentas] = await conexion.execute(
      `SELECT id
       FROM usuarios
       WHERE id = ?
         AND activo = 1
         AND estado_cuenta = 'aprobada'
       FOR UPDATE`,
      [cuenta.id]
    );

    if (!cuentas.length) {
      await conexion.rollback();
      return res.json({ mensaje: mensajeGeneral });
    }

    // Solicitar otro enlace invalida los anteriores.
    await conexion.execute(
      `UPDATE recuperaciones_contrasena
       SET usado_en = UTC_TIMESTAMP()
       WHERE usuario_id = ? AND usado_en IS NULL`,
      [cuenta.id]
    );

    await conexion.execute(
      `INSERT INTO recuperaciones_contrasena
       (id, usuario_id, token_hash, vence_en)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))`,
      [recuperacionId, cuenta.id, hashToken(token)]
    );

    await conexion.commit();
    conexion.release();
    conexion = null;

    try {
      const resultado = await transporte.sendMail({
        from: process.env.SMTP_FROM,
        to: cuenta.correo,
        subject: 'Recuperación de contraseña — Control de Sobrantes',
        text:
          'Recibimos una solicitud para cambiar tu contraseña.\n\n' +
          'Abre este enlace:\n' +
          enlace.toString() +
          '\n\nEl enlace vence en 15 minutos y solo puede usarse una vez.' +
          '\nSi no solicitaste el cambio, ignora este correo.',
      });

      if (!resultado.accepted?.length) {
        throw new Error('Correo no aceptado');
      }
    } catch (error) {
      // No deja válido un enlace cuyo envío falló.
      await db.execute(
        `UPDATE recuperaciones_contrasena
         SET usado_en = UTC_TIMESTAMP()
         WHERE id = ?`,
        [recuperacionId]
      );

      // No muestra datos de la cuenta ni el token.
      console.error('Falló envío de recuperación:', error.code || 'ENVIO');
    }

    return res.json({ mensaje: mensajeGeneral });
  } catch (error) {
    if (conexion) {
      await conexion.rollback();
    }

    console.error('Error en recuperación:', error.code || 'RECUPERACION');

    return res.status(503).json({
      mensaje:
        'El servicio de recuperación no está disponible. Intenta más tarde.',
    });
  } finally {
    if (conexion) {
      conexion.release();
    }
  }
});

router.post('/restablecer-contrasena', limitar, async (req, res) => {
  const { token, contrasena } = req.body || {};

  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return res.status(400).json({
      mensaje: 'El enlace no es válido. Solicita uno nuevo.',
    });
  }

  if (
    typeof contrasena !== 'string' ||
    contrasena.length < 8 ||
    Buffer.byteLength(contrasena, 'utf8') > 72
  ) {
    return res.status(400).json({
      mensaje:
        'Usa al menos 8 caracteres y como máximo 72 bytes.',
    });
  }

  let conexion;

  try {
    const resumen = hashToken(token);

    const [referencias] = await db.execute(
      `SELECT usuario_id
       FROM recuperaciones_contrasena
       WHERE token_hash = ?
       LIMIT 1`,
      [resumen]
    );

    if (!referencias.length) {
      return res.status(400).json({
        mensaje: 'El enlace no es válido. Solicita uno nuevo.',
      });
    }

    const passwordHash = await bcrypt.hash(contrasena, 12);

    conexion = await db.getConnection();
    await conexion.beginTransaction();

    // Bloquea primero la cuenta para coordinar cambios simultáneos.
    const [usuarios] = await conexion.execute(
      `SELECT id
       FROM usuarios
       WHERE id = ?
         AND activo = 1
         AND estado_cuenta = 'aprobada'
       FOR UPDATE`,
      [referencias[0].usuario_id]
    );

    const [enlaces] = await conexion.execute(
      `SELECT id
       FROM recuperaciones_contrasena
       WHERE token_hash = ?
         AND usado_en IS NULL
         AND vence_en > UTC_TIMESTAMP()
       FOR UPDATE`,
      [resumen]
    );

    if (!usuarios.length || !enlaces.length) {
      await conexion.rollback();

      return res.status(400).json({
        mensaje:
          'El enlace venció, ya fue utilizado o la cuenta no está habilitada.',
      });
    }

    const usuarioId = usuarios[0].id;

    await conexion.execute(
      `UPDATE usuarios
       SET password_hash = ?,
           version_sesion = version_sesion + 1
       WHERE id = ?`,
      [passwordHash, usuarioId]
    );

    await conexion.execute(
      `UPDATE recuperaciones_contrasena
       SET usado_en = UTC_TIMESTAMP()
       WHERE usuario_id = ? AND usado_en IS NULL`,
      [usuarioId]
    );

    await conexion.commit();

    return res.json({
      mensaje:
        'Contraseña actualizada. Inicia sesión con tu nueva contraseña.',
    });
  } catch (error) {
    if (conexion) {
      await conexion.rollback();
    }

    console.error('Error al restablecer:', error.code || 'RESTABLECER');

    return res.status(500).json({
      mensaje: 'No se pudo cambiar la contraseña.',
    });
  } finally {
    if (conexion) {
      conexion.release();
    }
  }
});

module.exports = router;