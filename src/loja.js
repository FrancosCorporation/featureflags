// FeatureFlags — CRUD validado e avaliação determinística em SQLite.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

function falha(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { codigo });
}

function validarFlag({ chave, descricao = '', rollout = 100, atributo = '', valorAlvo = '' } = {}) {
  if (typeof chave !== 'string' || !/^[a-z0-9_.-]{2,60}$/i.test(chave)) {
    throw falha('chave', 'chave inválida (2-60 caracteres: letras, números, ponto, hífen ou sublinhado)');
  }
  if (typeof descricao !== 'string' || descricao.length > 500) throw falha('dados', 'descrição inválida');
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw falha('rollout', 'rollout deve ser um inteiro de 0 a 100');
  if (typeof atributo !== 'string' || atributo.length > 60 || (atributo && (!/^[a-z0-9_.-]+$/i.test(atributo) || ['__proto__', 'prototype', 'constructor'].includes(atributo.toLowerCase())))) {
    throw falha('dados', 'atributo inválido');
  }
  if (typeof valorAlvo !== 'string' || valorAlvo.length > 200 || (Boolean(atributo) !== Boolean(valorAlvo))) {
    throw falha('dados', 'atributo e valor-alvo devem ser informados juntos');
  }
}

export function criarLoja(caminhoDb = 'featureflags.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS flags (
      chave TEXT PRIMARY KEY,
      descricao TEXT NOT NULL DEFAULT '',
      ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
      rollout INTEGER NOT NULL DEFAULT 100 CHECK (rollout BETWEEN 0 AND 100),
      atributo TEXT NOT NULL DEFAULT '',
      valor_alvo TEXT NOT NULL DEFAULT ''
    )
  `);

  // Corrige valores booleanos legados e falha se a configuração persistida não puder ser interpretada.
  db.exec("UPDATE flags SET ativa = CASE lower(CAST(ativa AS TEXT)) WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE ativa END WHERE typeof(ativa) = 'text'");
  db.exec("UPDATE flags SET descricao = COALESCE(descricao, ''), atributo = COALESCE(atributo, ''), valor_alvo = COALESCE(valor_alvo, '')");
  const invalidas = db.prepare(`
    SELECT COUNT(*) AS n FROM flags
    WHERE typeof(ativa) != 'integer' OR ativa NOT IN (0, 1)
       OR typeof(rollout) != 'integer' OR rollout NOT BETWEEN 0 AND 100
       OR (atributo = '') != (valor_alvo = '')
  `).get().n;
  if (invalidas) {
    db.close();
    throw new Error('O banco contém flags inválidas. Revise ativa, rollout e alvo antes de iniciar.');
  }

  const cache = new Map();
  const cacheTtlMs = 10_000;
  const cacheMax = 5_000;
  const invalidar = (chave) => cache.delete(chave);

  function obter(chave) {
    const hit = cache.get(chave);
    if (hit && hit.expira > Date.now()) return hit.flag ? { ...hit.flag } : null;
    if (hit) cache.delete(chave);
    const flag = db.prepare('SELECT * FROM flags WHERE chave = ?').get(chave) || null;
    if (flag) {
      if (cache.size >= cacheMax) cache.delete(cache.keys().next().value);
      cache.set(chave, { flag, expira: Date.now() + cacheTtlMs });
    }
    return flag ? { ...flag } : null;
  }

  return {
    db,

    criar(dados = {}) {
      const normalizados = {
        chave: dados.chave,
        descricao: dados.descricao ?? '',
        rollout: dados.rollout ?? 100,
        atributo: typeof dados.atributo === 'string' ? dados.atributo.trim() : dados.atributo ?? '',
        valorAlvo: typeof dados.valorAlvo === 'string' ? dados.valorAlvo.trim() : dados.valorAlvo ?? ''
      };
      validarFlag(normalizados);
      try {
        db.prepare('INSERT INTO flags (chave, descricao, rollout, atributo, valor_alvo) VALUES (?, ?, ?, ?, ?)')
          .run(normalizados.chave, normalizados.descricao.trim(), normalizados.rollout, normalizados.atributo, normalizados.valorAlvo);
      } catch (erro) {
        if (String(erro.code || '').startsWith('SQLITE_CONSTRAINT')) throw falha('conflito', 'já existe uma flag com essa chave');
        throw erro;
      }
      invalidar(normalizados.chave);
      return obter(normalizados.chave);
    },

    obter,

    listar() {
      return db.prepare('SELECT * FROM flags ORDER BY chave').all();
    },

    atualizar(chave, mudancas = {}) {
      if (!mudancas || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw falha('dados', 'alterações inválidas');
      const permitidos = new Set(['descricao', 'ativa', 'rollout', 'atributo', 'valor_alvo']);
      const chaves = Object.keys(mudancas);
      if (chaves.some((campo) => !permitidos.has(campo))) throw falha('dados', 'campo de atualização não permitido');
      if (!obter(chave)) throw falha('404', 'flag não encontrada');
      if (!chaves.length) return obter(chave);

      const atual = obter(chave);
      const descricao = Object.hasOwn(mudancas, 'descricao') ? mudancas.descricao : atual.descricao;
      const rollout = Object.hasOwn(mudancas, 'rollout') ? mudancas.rollout : atual.rollout;
      const atributoBruto = Object.hasOwn(mudancas, 'atributo') ? mudancas.atributo : atual.atributo;
      const valorAlvoBruto = Object.hasOwn(mudancas, 'valor_alvo') ? mudancas.valor_alvo : atual.valor_alvo;
      const atributo = typeof atributoBruto === 'string' ? atributoBruto.trim() : atributoBruto;
      const valorAlvo = typeof valorAlvoBruto === 'string' ? valorAlvoBruto.trim() : valorAlvoBruto;
      if (typeof descricao !== 'string' || descricao.length > 500) throw falha('dados', 'descrição inválida');
      if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw falha('rollout', 'rollout deve ser um inteiro de 0 a 100');
      if (typeof atributo !== 'string' || atributo.length > 60 || (atributo && (!/^[a-z0-9_.-]+$/i.test(atributo) || ['__proto__', 'prototype', 'constructor'].includes(atributo.toLowerCase())))) throw falha('dados', 'atributo inválido');
      if (typeof valorAlvo !== 'string' || valorAlvo.length > 200 || (Boolean(atributo) !== Boolean(valorAlvo))) throw falha('dados', 'atributo e valor-alvo devem ser informados juntos');

      const sets = [];
      const valores = [];
      for (const campo of chaves) {
        let valor = mudancas[campo];
        if (campo === 'ativa') {
          if (valor === true || valor === 1) valor = 1;
          else if (valor === false || valor === 0) valor = 0;
          else throw falha('dados', 'ativa deve ser booleano');
        }
        if (campo === 'descricao' || campo === 'atributo' || campo === 'valor_alvo') valor = valor.trim();
        sets.push(`${campo} = ?`);
        valores.push(valor);
      }
      const resultado = db.prepare(`UPDATE flags SET ${sets.join(', ')} WHERE chave = ?`).run(...valores, chave);
      if (resultado.changes !== 1) throw falha('404', 'flag não encontrada');
      invalidar(chave);
      return obter(chave);
    },

    // Avaliação interna inclui diagnóstico para o domínio; a rota pública filtra e retorna apenas {on}.
    avaliar(chave, contexto = {}) {
      const flag = obter(chave);
      if (!flag) return { on: false, motivo: 'inexistente' };
      if (Number(flag.ativa) !== 1) return { on: false, motivo: 'kill-switch' };
      if (flag.atributo) {
        if (contexto[flag.atributo] !== flag.valor_alvo) return { on: false, motivo: 'fora-do-alvo' };
        return { on: true, motivo: 'no-alvo' };
      }
      if (flag.rollout >= 100) return { on: true, motivo: 'rollout-100' };
      if (flag.rollout <= 0) return { on: false, motivo: 'rollout-0' };
      const hash = createHash('sha256').update(`${chave}:${contexto.usuario || 'anonimo'}`).digest();
      const valor = (hash.readUInt32BE(0) / 0x1_0000_0000) * 100;
      return { on: valor < flag.rollout, motivo: 'rollout', valor };
    }
  };
}
