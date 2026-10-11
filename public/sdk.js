// SDK leve: rollout anônimo usa identificador estável; atributos exigem token assinado do backend.
(function (global) {
  'use strict';

  const FeatureFlags = {
    async avaliar(chave, contexto = {}) {
      if (typeof chave !== 'string' || !chave) throw new TypeError('Informe a chave da feature flag.');
      const parametros = new URLSearchParams();
      if (typeof contexto.usuario === 'string' && contexto.usuario) parametros.set('usuario', contexto.usuario);
      const consulta = parametros.toString();
      const caminho = `/api/flags/${encodeURIComponent(chave)}/avaliar${consulta ? `?${consulta}` : ''}`;
      const headers = { Accept: 'application/json' };
      if (typeof contexto.token === 'string' && contexto.token) headers.Authorization = `Bearer ${contexto.token}`;
      const resposta = await fetch(caminho, { headers, cache: 'no-store', credentials: 'same-origin' });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo?.erro?.mensagem || `Falha ao avaliar a flag (${resposta.status}).`);
      return corpo;
    }
  };

  global.FeatureFlags = Object.freeze(FeatureFlags);
})(globalThis);
