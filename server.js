// FeatureFlags — avaliação pública filtrada e gestão privada de flags.
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { criarLoja } from './src/loja.js';
import { inicializarAutenticacao } from './src/auth.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const PORT = Number(process.env.PORT || 3500);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT precisa ser um inteiro entre 1 e 65535.');

const loja = criarLoja(process.env.FF_DB || 'featureflags.db');
const auth = inicializarAutenticacao(loja.db);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

const desenvolvimento = app.get('env') !== 'production';
app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: { 'upgrade-insecure-requests': desenvolvimento ? null : [] }
  }
}));
app.use(express.json({ limit: '16kb' }));

function criarLimitador(limite, janelaMs, maxChaves = 20_000) {
  const janelas = new Map();
  let operacoes = 0;
  return (chave) => {
    const agora = Date.now();
    let janela = janelas.get(chave);
    if (!janela || janela.ate <= agora) {
      janela = { usos: 0, ate: agora + janelaMs };
      janelas.set(chave, janela);
    }
    const permitido = janela.usos < limite;
    if (permitido) janela.usos += 1;
    if (++operacoes % 256 === 0 || janelas.size > maxChaves) {
      for (const [k, v] of janelas) if (v.ate <= agora) janelas.delete(k);
      while (janelas.size > maxChaves) janelas.delete(janelas.keys().next().value);
    }
    return { permitido, aguardeMs: Math.max(1, janela.ate - agora) };
  };
}

const limiteLoginIp = criarLimitador(20, 5 * 60 * 1000);
const limiteLoginEmail = criarLimitador(5, 5 * 60 * 1000);
const limiteAvaliacao = criarLimitador(600, 60 * 1000);

function aplicarLimite(req, res, regras) {
  const bloqueados = regras.filter((regra) => !regra.permitido);
  if (!bloqueados.length) return false;
  const aguarde = Math.max(1, Math.ceil(Math.max(...bloqueados.map((r) => r.aguardeMs)) / 1000));
  res.setHeader('Retry-After', String(aguarde));
  res.status(429).json({ erro: { codigo: 'limite', mensagem: 'Muitas solicitações. Aguarde antes de tentar novamente.' } });
  return true;
}

function limitarLogin(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const valor = req.body?.email;
  const email = typeof valor === 'string' && valor.length <= 254 ? valor.trim().toLowerCase() : '';
  const regras = [limiteLoginIp(ip)];
  if (email) regras.push(limiteLoginEmail(email));
  if (aplicarLimite(req, res, regras)) return;
  next();
}

function semCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function erroApi(erro, res) {
  const status = { chave: 400, rollout: 400, dados: 400, token: 401, credenciais: 401, permissao: 403, conflito: 409, '404': 404 }[erro.codigo] || 500;
  if (status === 500) console.error('[FeatureFlags] Erro interno:', erro);
  const mensagem = status === 500 ? 'Erro interno do servidor' : erro.message;
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : erro.codigo, mensagem } });
}

// Login de administrador.
app.post('/api/admin/login', semCache, limitarLogin, auth.login);

// Avaliação pública para o SDK. A identidade de rollout pode vir do cliente;
// atributos de segmentação só vêm em um JWT emitido por backend confiável.
app.get('/api/flags/:chave/avaliar', semCache, (req, res) => {
  if (aplicarLimite(req, res, [limiteAvaliacao(req.ip || req.socket.remoteAddress || 'desconhecido')])) return;
  try {
    const contexto = auth.contextoDeAvaliacao(req);
    const resultado = loja.avaliar(req.params.chave, contexto);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ on: resultado.on === true });
  } catch (erro) {
    erroApi(erro, res);
  }
});

// Gestão privada de flags.
app.use('/api/flags', semCache);
app.get('/api/flags', auth.exigirAdmin, (req, res) => res.json(loja.listar()));
app.post('/api/flags', auth.exigirAdmin, (req, res) => {
  try { res.status(201).json(loja.criar(req.body ?? {})); }
  catch (erro) { erroApi(erro, res); }
});
app.patch('/api/flags/:chave', auth.exigirAdmin, (req, res) => {
  try { res.json(loja.atualizar(req.params.chave, req.body ?? {})); }
  catch (erro) { erroApi(erro, res); }
});

app.use('/api', (req, res) => res.status(404).json({ erro: { codigo: '404', mensagem: 'Rota não encontrada' } }));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};
app.use(async (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const caminho = req.path === '/' ? resolve(PUBLIC, 'index.html') : resolve(PUBLIC, `.${req.path}`);
  if (caminho !== PUBLIC && !caminho.startsWith(`${PUBLIC}${sep}`)) {
    return res.status(404).type('text/plain').send('Não encontrado');
  }
  try {
    const dados = await readFile(caminho);
    res.setHeader('Content-Type', MIME[extname(caminho)] || 'application/octet-stream');
    if (req.path === '/sdk.js') {
      const etag = `"${createHash('sha256').update(dados).digest('base64url')}"`;
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (req.method === 'HEAD') return res.status(200).end();
    res.status(200).send(dados);
  } catch {
    res.status(404).type('text/plain').send('Não encontrado');
  }
});

app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  const status = Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 500 ? erro.status : 500;
  if (status === 500) console.error('[FeatureFlags] Erro HTTP interno:', erro);
  const mensagem = status === 413 ? 'Corpo da requisição excede 16 KiB' : status === 400 ? 'JSON inválido' : 'Erro interno do servidor';
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : 'requisicao_invalida', mensagem } });
});

const server = http.createServer(app);
export { server, app, loja };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`FeatureFlags em http://localhost:${PORT} (painel + SDK em /sdk.js)`));
}
