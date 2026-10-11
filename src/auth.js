// Contas administrativas e contexto de avaliação assinado por um backend confiável.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

function segredo(nome) {
  const valor = process.env[nome];
  if (typeof valor !== 'string' || Buffer.byteLength(valor, 'utf8') < 32) {
    throw new Error(`${nome} ausente ou curto — defina um segredo com pelo menos 32 bytes.`);
  }
  return valor;
}

const JWT_SECRET = segredo('JWT_SECRET');
const EVALUATION_SECRET = segredo('EVALUATION_SECRET');
if (JWT_SECRET === EVALUATION_SECRET) throw new Error('JWT_SECRET e EVALUATION_SECRET precisam ser diferentes.');
const HASH_DUMMY = bcrypt.hashSync('senha-invalida-para-featureflags-admin', 12);
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+$/;

function emailCanonico(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function falhaContexto(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { codigo });
}

export function inicializarAutenticacao(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      senha_hash TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const total = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (total === 0) {
    const email = emailCanonico(process.env.ADMIN_EMAIL);
    const senha = process.env.ADMIN_PASSWORD;
    if (!EMAIL_VALIDO.test(email) || email.length > 254 || typeof senha !== 'string' || senha.length < 12 || senha.length > 128) {
      throw new Error('Primeiro início sem administrador: defina ADMIN_EMAIL válido e ADMIN_PASSWORD com 12 a 128 caracteres.');
    }
    db.prepare('INSERT INTO admins (id, email, senha_hash) VALUES (?, ?, ?)')
      .run(randomUUID(), email, bcrypt.hashSync(senha, 12));
  }

  function login(req, res) {
    const email = emailCanonico(req.body?.email);
    const senha = req.body?.senha;
    const admin = db.prepare('SELECT id, email, senha_hash FROM admins WHERE email = ? COLLATE NOCASE').get(email);
    const senhaValida = bcrypt.compareSync(typeof senha === 'string' && senha.length <= 128 ? senha : '', admin?.senha_hash || HASH_DUMMY);
    if (!admin || typeof senha !== 'string' || senha.length < 12 || senha.length > 128 || !senhaValida) {
      return res.status(401).json({ erro: { codigo: 'credenciais', mensagem: 'Credenciais inválidas' } });
    }
    const token = jwt.sign(
      { sub: admin.id, email: admin.email, role: 'admin' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '12h', issuer: 'featureflags', audience: 'featureflags-admin' }
    );
    return res.json({ token, admin: { id: admin.id, email: admin.email } });
  }

  function exigirAdmin(req, res, next) {
    const cabecalho = req.headers.authorization;
    const token = cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    if (!token) return res.status(401).json({ erro: { codigo: 'token', mensagem: 'Token administrativo ausente ou inválido' } });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'], issuer: 'featureflags', audience: 'featureflags-admin'
      });
    } catch {
      return res.status(401).json({ erro: { codigo: 'token', mensagem: 'Token administrativo ausente ou inválido' } });
    }
    if (payload.role !== 'admin' || typeof payload.sub !== 'string' || !payload.sub) {
      return res.status(403).json({ erro: { codigo: 'permissao', mensagem: 'Acesso restrito a administradores' } });
    }
    req.admin = payload;
    return next();
  }

  function contextoDeAvaliacao(req) {
    const cabecalho = req.headers.authorization;
    if (!cabecalho) {
      const usuario = req.query.usuario;
      if (usuario !== undefined && (typeof usuario !== 'string' || usuario.length > 128)) {
        throw falhaContexto('dados', 'identificador de usuário inválido');
      }
      const contexto = Object.create(null);
      contexto.usuario = usuario || 'anonimo';
      return contexto;
    }
    if (!cabecalho.startsWith('Bearer ') || cabecalho.length > 4100) {
      throw falhaContexto('token', 'token de avaliação inválido');
    }

    let payload;
    try {
      payload = jwt.verify(cabecalho.slice(7), EVALUATION_SECRET, {
        algorithms: ['HS256'], issuer: 'featureflags-context', audience: 'featureflags-evaluation'
      });
    } catch {
      throw falhaContexto('token', 'token de avaliação inválido ou expirado');
    }
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > 900 ||
        !payload.attributes || typeof payload.attributes !== 'object' || Array.isArray(payload.attributes)) {
      throw falhaContexto('token', 'token de avaliação sem identidade ou atributos válidos');
    }
    const contexto = Object.create(null);
    contexto.usuario = payload.sub;
    for (const [atributo, valor] of Object.entries(payload.attributes)) {
      if (atributo === 'usuario' || ['__proto__', 'prototype', 'constructor'].includes(atributo.toLowerCase()) ||
          !/^[a-z0-9_.-]{1,60}$/i.test(atributo) || typeof valor !== 'string' || valor.length > 200) {
        throw falhaContexto('token', 'atributos do token de avaliação inválidos');
      }
      contexto[atributo] = valor;
    }
    return contexto;
  }

  return { login, exigirAdmin, contextoDeAvaliacao };
}
