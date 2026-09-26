// Testes do FeatureFlags — avaliação booleana/percentual/alvo, kill-switch, CRUD (unidade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarLoja } from '../src/loja.js';

const novaLoja = () => criarLoja(join(mkdtempSync(join(tmpdir(), 'ff-')), 't.db'));

test('CRUD: cria, obtém, lista, atualiza', () => {
  const loja = novaLoja();
  const f = loja.criar({ chave: 'novo-checkout', descricao: 'fluxo novo' });
  assert.equal(f.chave, 'novo-checkout');
  assert.equal(f.ativa, 1);
  assert.equal(loja.listar().length, 1);
  loja.atualizar('novo-checkout', { descricao: 'v2' });
  assert.equal(loja.obter('novo-checkout').descricao, 'v2');
});

test('chave inválida e rollout fora da faixa rejeitados', () => {
  const loja = novaLoja();
  assert.throws(() => loja.criar({ chave: 'x' }));
  assert.throws(() => loja.criar({ chave: 'ok', rollout: 150 }));
});

test('avaliação: flag inexistente => off', () => {
  const loja = novaLoja();
  assert.deepEqual(loja.avaliar('nada'), { on: false, motivo: 'inexistente' });
});

test('kill-switch: ativa=0 => off mesmo com rollout 100', () => {
  const loja = novaLoja();
  loja.criar({ chave: 'flag-f', rollout: 100 });
  loja.atualizar('flag-f', { ativa: 0 });
  assert.deepEqual(loja.avaliar('flag-f'), { on: false, motivo: 'kill-switch' });
});

test('alvo por atributo: só o alvo liga', () => {
  const loja = novaLoja();
  loja.criar({ chave: 'beta', atributo: 'plan', valorAlvo: 'pro' });
  assert.deepEqual(loja.avaliar('beta', { plan: 'pro' }), { on: true, motivo: 'no-alvo' });
  assert.equal(loja.avaliar('beta', { plan: 'free' }).on, false);
});

test('rollout: 100% liga sempre, 0% desliga sempre', () => {
  const loja = novaLoja();
  loja.criar({ chave: 'tudo', rollout: 100 });
  loja.criar({ chave: 'nada', rollout: 0 });
  assert.equal(loja.avaliar('tudo', { usuario: 'x' }).on, true);
  assert.equal(loja.avaliar('nada', { usuario: 'x' }).on, false);
});

test('rollout determinístico: mesma chave+usuário => mesmo resultado', () => {
  const loja = novaLoja();
  loja.criar({ chave: 'canary', rollout: 50 });
  const r1 = loja.avaliar('canary', { usuario: 'maria' });
  const r2 = loja.avaliar('canary', { usuario: 'maria' });
  assert.equal(r1.on, r2.on);
  assert.equal(r1.motivo, 'rollout');
});

test('rollout 50% distribui entre usuários (aprox.)', () => {
  const loja = novaLoja();
  loja.criar({ chave: 'dist', rollout: 50 });
  let ligados = 0;
  for (let i = 0; i < 200; i++) {
    if (loja.avaliar('dist', { usuario: `user-${i}` }).on) ligados++;
  }
  const proporcao = ligados / 200;
  assert.ok(proporcao > 0.3 && proporcao < 0.7, `distribuição razoável: ${proporcao.toFixed(2)}`);
});
