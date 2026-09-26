// FeatureFlags — servidor: API (CRUD + avaliação) + SDK JS servido + painel admin.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarLoja } from './src/loja.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3500;
const loja = criarLoja(process.env.FF_DB || 'featureflags.db');

const app = express();
app.use(express.json());

// avaliação (rota pública do SDK — sem dados sensíveis)
app.get('/api/flags/:chave/avaliar', (req, res) => {
  const contexto = { usuario: req.query.usuario };
  res.json(loja.avaliar(req.params.chave, contexto));
});

// CRUD (admin)
app.get('/api/flags', (req, res) => res.json(loja.listar()));
app.post('/api/flags', (req, res) => {
  try { res.status(201).json(loja.criar(req.body)); }
  catch (e) { res.status(400).json({ erro: { codigo: e.codigo, mensagem: e.message } }); }
});
app.patch('/api/flags/:chave', (req, res) => res.json(loja.atualizar(req.params.chave, req.body)));

// SDK JS do cliente (servido pelo próprio servidor)
app.get('/sdk.js', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
  res.end(`// FeatureFlags SDK (servido pelo próprio servidor)
const FF = {
  async avaliar(chave, contexto = {}) {
    const params = new URLSearchParams(contexto).toString();
    const r = await fetch('/api/flags/' + encodeURIComponent(chave) + '/avaliar' + (params ? '?' + params : ''));
    return r.json();
  }
};`);
});

// painel admin
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/sdk.js') return next();
  try {
    let arquivo = normalize(join(ROOT, 'public', req.path));
    if (!arquivo.startsWith(ROOT)) throw new Error('fora');
    const dados = await readFile(arquivo); // lê ANTES de escrever headers (evita ERR_HTTP_HEADERS_SENT)
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'text/html; charset=utf-8' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('erro interno');
    }
  }
});

const server = http.createServer(app);
export { server, loja };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`FeatureFlags em http://localhost:${PORT} (painel + SDK em /sdk.js)`));
}
