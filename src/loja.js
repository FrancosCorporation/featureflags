// FeatureFlags M1 — núcleo: CRUD de flags + avaliação (booleana, percentual, por atributo).
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function criarLoja(caminhoDb = 'featureflags.db') {
  const db = new DatabaseSync(caminhoDb);
  db.exec(`
  CREATE TABLE IF NOT EXISTS flags (
    chave TEXT PRIMARY KEY,
    descricao TEXT DEFAULT '',
    ativa INTEGER NOT NULL DEFAULT 1,
    rollout INTEGER NOT NULL DEFAULT 100,
    atributo TEXT DEFAULT '',
    valor_alvo TEXT DEFAULT ''
  );
  `);

  return {
    db,

    criar({ chave, descricao = '', rollout = 100, atributo = '', valorAlvo = '' }) {
      if (!/^[a-z0-9_.-]{2,60}$/i.test(chave)) throw Object.assign(new Error('chave inválida (2-60, [a-z0-9_.-])'), { codigo: 'chave' });
      if (rollout < 0 || rollout > 100) throw Object.assign(new Error('rollout 0-100'), { codigo: 'rollout' });
      db.prepare('INSERT INTO flags (chave, descricao, rollout, atributo, valor_alvo) VALUES (?, ?, ?, ?, ?)')
        .run(chave, descricao, rollout, atributo, valorAlvo);
      return this.obter(chave);
    },

    obter(chave) {
      return db.prepare('SELECT * FROM flags WHERE chave = ?').get(chave) || null;
    },

    listar() {
      return db.prepare('SELECT * FROM flags ORDER BY chave').all();
    },

    atualizar(chave, mudancas) {
      const permitidos = ['descricao', 'ativa', 'rollout', 'atributo', 'valor_alvo'];
      const sets = Object.keys(mudancas).filter((k) => permitidos.includes(k));
      if (!sets.length) return this.obter(chave);
      db.prepare(`UPDATE flags SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE chave = ?`)
        .run(...sets.map((k) => mudancas[k]), chave);
      return this.obter(chave);
    },

    // avaliação: kill-switch (ativa) -> alvo por atributo -> rollout percentual (hash determinístico)
    avaliar(chave, contexto = {}) {
      const flag = this.obter(chave);
      if (!flag) return { on: false, motivo: 'inexistente' };
      if (!flag.ativa) return { on: false, motivo: 'kill-switch' };
      if (flag.atributo) {
        if (contexto[flag.atributo] !== flag.valor_alvo) {
          return { on: false, motivo: 'fora-do-alvo' };
        }
        return { on: true, motivo: 'no-alvo' };
      }
      // rollout percentual: hash determinístico (mesma chave+usuário => mesmo resultado)
      if (flag.rollout >= 100) return { on: true, motivo: 'rollout-100' };
      if (flag.rollout <= 0) return { on: false, motivo: 'rollout-0' };
      const hash = createHash("sha256").update(`${chave}:${contexto.usuario || 'anonimo'}`).digest();
      const valor = (hash[0] << 8 | hash[1]) / 65535 * 100;
      return { on: valor < flag.rollout, motivo: 'rollout', valor };
    }
  };
}
