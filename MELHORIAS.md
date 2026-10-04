# MELHORIAS — featureflags

> **Gerado por análise de código em 2026-10-02** · Stack: Node 22 (Express + `node:sqlite`), **sem** JWT/BCrypt
> Branch `main` · base `076f9ed` (M1: avaliação booleana/percentual/atributo + kill-switch + SDK + painel, 8/8 testes) · 272 LOC · **1 suite** · CI presente
>
> **Este arquivo é um plano de execução.** Cada item tem ID, `arquivo:linha`, mudança exata,
> critério de aceite e comando de verificação.

---

## 0. Como usar este documento

1. Execute na ordem **P0 → P1 → P2 → P3**, respeitando as ondas da §8.
2. Ao terminar um item: marque `- [x]`, rode o **Verificação**, comite `fix(<ID>): descrição`.
3. **Não feche a rota de avaliação.** `/api/flags/:chave/avaliar` é pública **por desenho** — é o
   que o SDK consome. O defeito é **o que** ela expõe e **como** confia no contexto, não ser
   pública (ver `SEC-02`/`SEC-03`).
4. **Não reescreva a avaliação.** O hash determinístico (`loja.js:60-61`) e a ordem
   kill-switch → atributo → rollout estão corretos. Os itens são de exposição e de confiança.
5. **Idioma:** português; commits em inglês com `fix:`/`feat:`/`docs:`.

---

## 1. Diagnóstico executivo

Plataforma de feature flags enxuta: CRUD de flags (admin), avaliação por booleana/atributo/rollout
percentual com hash determinístico, kill-switch, SDK JS servido em `/sdk.js` e painel. 4 arquivos de
código, 8 testes, CI.

**O que está bem (não reaça):**

| Item | Evidência |
|---|---|
| Hash **determinístico** no rollout (mesmo usuário → mesmo resultado sempre) | `loja.js:60` (`createHash('sha256').update(chave:usuario)`) |
| Kill-switch tem precedência sobre tudo | `loja.js:50` (primeiro check) |
| Allowlist de campos no `atualizar` (sem mass assignment nem SQLi) | `loja.js:38-39` |
| Chave de flag validada por regex (não pode injetar) | `loja.js:22` (`/^[a-z0-9_.-]{2,60}$/i`) |
| Rollout validado 0-100 | `loja.js:23` |
| `rollout=0` e `=100` tratados explicitamente (não depende do hash) | `loja.js:58-59` |
| `ataualizar` de flag inexistente devolve `null` (sem 500) | `loja.js:40,43` |
| Leitura do arquivo **antes** de escrever headers (evita `ERR_HTTP_HEADERS_SENT`) | `server.js:50` (comentado) |
| Erro do estático com try/catch aninhado | `server.js:53-62` |
| `NODE_ENV=test` não abre porta | `server.js:68` |

**O que está quebrado:**

1. **Painel admin sem autenticação**: `GET/POST/PATCH /api/flags` (`server.js:23-28`) — sem `jwt`,
   sem `bcrypt` no `package.json:10`. Qualquer pessoa **desliga todas as feature flags** da
   plataforma, ou cria flag nova.
2. **A rota pública de avaliação vaza dados internos de segmentação**: `avaliar` devolve
   `motivo` (`'no-alvo'`, `'fora-do-alvo'`, `'rollout'`) — o que revela ao cliente se ele está no
   público-alvo, revelando a estratégia de rollout antes do lançamento.
3. **O cliente controla o próprio contexto de avaliação**: `server.js:18`
   (`contexto = { usuario: req.query.usuario }`) — o **atributo** de segmentação não vem do contexto,
   então o valor que decide é sempre `undefined`, e a segmentação por atributo **nunca casa**.

---

## 2. Tabela de prioridades

| ID | Título | Sev | Arquivo | Depende de |
|---|---|---|---|---|
| SEC-01 | Painel admin sem auth (desliga todas as flags) | **P0** | `server.js:23,24,28` | SEC-05 |
| SEC-02 | `motivo` da avaliação vaza a estratégia de rollout | **P1** | `loja.js:49-62` | — |
| SEC-03 | Segmentação por atributo nunca casa (bug funcional grave) | **P1** | `server.js:18`, `loja.js:51-55` | — |
| SEC-04 | `GET /api/flags` público expõe config interna | **P1** | `server.js:23` | SEC-05 |
| SEC-05 | Sem qualquer auth (falta JWT/BCrypt no projeto) | **P0** | `package.json:10` | — |
| SEC-06 | Sem auth no SDK servido (`/sdk.js`) — cache poisoning | **P2** | `server.js:31-41` | — |
| BUG-02 | `atualizar` de flag inexistente devolve `null` em 200 | **P2** | `loja.js:37-44` | — |
| BUG-03 | Rollout usa só 2 bytes do hash (16 bits) — distribuição enviesada | **P2** | `loja.js:61` | — |
| BUG-04 | `ativa` aceito como string ("false" é truthy) | **P2** | `loja.js:37-43` | — |
| BUG-05 | Sem rate limit na rota de avaliação | **P2** | `server.js:17-20` | — |
| IMP-01 | Sem cache — avaliação é 1 query por chamada, por request | **P2** | `server.js:19` | — |
| IMP-02 | SDK inline em string de template (injetável) | **P2** | `server.js:33-40` | — |
| TEST-01 | Testes cobrem avaliação, não exposição nem admin | **P1** | `test/loja-test.mjs` | SEC-01, SEC-05 |
| DEVOPS-01 | `featureflags.db` commitado no repo | **P1** | `featureflags.db` | — |
| DEVOPS-02 | Sem `.env.example` | **P3** | *(ausente)* | SEC-05 |
| DOC-01 | README não explica o modelo de avaliação/trust | **P2** | `README.md` (43 linhas) | SEC-02, BUG-01 |
| DOC-02 | Falta `SECURITY.md` (exposição de flags é sigilo de negócio) | **P3** | *(ausente)* | — |

**Placar: 2 P0 · 5 P1 · 8 P2 · 2 P3 = 17 itens.**

---

## 3. Segurança
### SEC-05 · Sem qualquer auth (falta JWT/BCrypt no projeto) · [P0]

- **Arquivo:** `package.json:10` · `server.js:22-28`
- **Evidência:** `dependencies` tem **apenas** `express`. Não há `jsonwebtoken`, `bcryptjs`, nem
  middleware `auth` — as rotas de CRUD de flags são públicas.
- **Impacto:** raiz de `SEC-01` e `SEC-04`. Sem porta de entrada, qualquer pessoa com a URL altera a
  configuração de rollout da plataforma inteira.
- **Mudança:** (1) adicionar `jsonwebtoken` + `bcryptjs` (mesmo padrão de `agendaflow-saas` e
  `kanbanex`, incluindo o `throw` no segredo ausente); (2) `src/auth.js` com `exigirAdmin`;
  (3) tabela `admins` semeada de `ADMIN_EMAIL`/`ADMIN_PASSWORD` (padrão `base_fundation`).
- **Aceite:** rotas de CRUD sem token → `401`; com token sem papel admin → `403`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3500/api/flags   # 401
  curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3500/api/flags/x/avaliar?usuario=u'  # 200 (publica)
  ```

### SEC-01 · Painel admin sem auth (desliga todas as flags) · [P0]

- **Arquivo:** `server.js:23` (`GET /api/flags`), `:24-27` (`POST /api/flags`), `:28` (`PATCH /api/flags/:chave`)
- **Evidência:** nenhuma das três tem middleware. `atualizar` aceita `ativa` na allowlist
  (`loja.js:38`), ou seja, `PATCH {"ativa": false}` **desliga** a flag.
- **Impacto:** desligamento **não autorizado** de feature em produção (ou qualquer flag nova) —
  o equivalente a "desativar o botão de checkout do site inteiro" com um `curl` anônimo. Como
  feature flag controla rollout, isso é incidente de negócio, não só técnico.
- **Mudança:** (requer `SEC-05`) `exigirAdmin` nas três rotas; **manter pública apenas**
  `GET /api/flags/:chave/avaliar` (o SDK) e `/sdk.js`.
- **Aceite:** `PATCH {"ativa":false}` sem token → `401`; com token de cliente → `403`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X PATCH http://localhost:3500/api/flags/minha \
    -H 'Content-Type: application/json' -d '{"ativa":false}'   # 401
  ```

### SEC-04 · `GET /api/flags` público expõe config interna · [P1]

- **Arquivo:** `server.js:23` · `loja.js:33-35`
- **Evidência:** rota pública; `listar()` faz `SELECT * FROM flags` — devolve `chave`, `descricao`,
  `ativa`, `rollout`, **`atributo`**, **`valor_alvo`**.
- **Impacto:** vazamento duplo: (a) a **lista completa de flags** — revela o que está sendo
  desenvolvido/experimentado antes do lançamento (nome da flag é o suficiente: `checkout-novo`,
  `beta-pagamento`); (b) **`atributo` + `valor_alvo`** — a estratégia exata de segmentação. Isso é
  sigilo de negócio para quem está numa fase de canary/beta, e a rota pública entrega de graça.
- **Mudança:** (requer `SEC-05`) `exigirAdmin` na listagem; para o cliente, expor apenas as flags
  que ele pode avaliar (que é `/avaliar`, com resposta filtrada — ver `SEC-02`).
- **Aceite:** `GET /api/flags` sem token → `401`; cliente só obtém `on` (não `atributo`/`valor_alvo`).
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3500/api/flags   # 401
  curl -s 'http://localhost:3500/api/flags/x/avaliar?usuario=u' | jq .     # sem atributo/valor_alvo
  ```

### SEC-02 · `motivo` da avaliação vaza a estratégia de rollout · [P1]

- **Arquivo:** `src/loja.js:49-62` (`avaliar` retorna `motivo` em todos os caminhos)
- **Evidência:** cada retorno carrega `motivo: 'inexistente'` / `'kill-switch'` / `'fora-do-alvo'` /
  `'no-alvo'` / `'rollout-100'` / `'rollout-0'` / `'rollout'` — e o último ainda devolve `valor`
  (o número do bucket do usuário na linha 62).
- **Impacto:** vazamento de duas formas. (1) O `valor` (bucket numérico) permite ao cliente
  **recalcular o hash e inferir o `rollout` real** (e a chave da flag) — quebra o sigilo do
  percentual. (2) O `motivo` revela se a feature está em kill-switch, se o usuário está/fora do
  alvo — o que confirma que existe uma segmentação e qual é seu efeito. Para um canary, isso é
  informação de negócio e de mercado.
- **Mudança:** (1) resposta pública devolve **apenas** `{ on: boolean }` (o SDK só precisa do bool);
  (2) `motivo`/`valor` só para admin autenticado (ou em `/api/flags/:chave/debug` com token);
  (3) se o motivo for útil ao cliente (ex.: "recarregue a página"), usar um código genérico.
- **Aceite:** `/avaliar` público devolve só `{on}`; sem `motivo`, sem `valor`, sem `rollout`.
- **Verificação:**
  ```bash
  curl -s 'http://localhost:3500/api/flags/x/avaliar?usuario=u' | jq 'keys'
  # esperado: ["on"]
  ```

### SEC-03 / BUG-01 · Segmentação por atributo nunca casa · [P1]

- **Arquivo:** `server.js:18` (`const contexto = { usuario: req.query.usuario }`) · `src/loja.js:51-55`
- **Evidência:**
  ```javascript
  const contexto = { usuario: req.query.usuario };   // server.js
  ...
  if (flag.atributo) {
    if (contexto[flag.atributo] !== flag.valor_alvo) return { on: false, motivo: 'fora-do-alvo' };
  ```
  O contexto do servidor **só tem `usuario`**. Se a flag tiver `atributo = 'plano'`, o código faz
  `contexto['plano']` → `undefined`, que nunca é igual a `valor_alvo` → **sempre** `fora-do-alvo`.
- **Impacto:** **a segmentação por atributo está completamente quebrada em produção** — a feature só
  ativa via rollout percentual ou `rollout=100`, nunca por atributo. É a forma mais comum de canary
  (beta para "quem tem plano pro"), então a capacidade está anunciadа e não funciona. Os testes
  passam porque chamam `avaliar` **direto** no núcleo com um contexto completo (`loja.js`), nunca
  pela rota HTTP.
- **Mudança:** (1) aceitar o atributo no request — mas **com cuidado** (ver `SEC-03` risco): o
  cliente não pode mentir sobre o próprio atributo sem后果; (2) para atributo sensível (plano,
  papel, tenant), o valor deve vir de **token assinado**, não de query string; (3) alternativa mais
  segura para o servidor: avaliar por segmento no servidor usando a identidade do token do SDK;
  (4) `TEST-01` cobre pela **rota HTTP**, não só pelo núcleo.
- **Aceite:** `POST`/criar flag com `atributo: 'plano', valor_alvo: 'pro'` + request com contexto
  correto → `on: true`.
- **Verificação:**
  ```bash
  # criar flag com atributo, avaliar pela rota com o contexto, conferir on=true
  curl -s 'http://localhost:3500/api/flags/x/avaliar?usuario=u&plano=pro' | jq .on   # hoje: false
  ```

### SEC-06 · Sem auth no SDK servido (`/sdk.js`) — cache poisoning · [P2]

- **Arquivo:** `server.js:31-41`
- **Evidência:** a rota monta o SDK por template string (linhas 33-40) e responde `200` sem cache
  headers nem ETag.
- **Impacto:** sem `Cache-Control` explícito, um **proxy/CDN intermediário** pode servir uma versão
  antiga do SDK a todos os clientes (o SDK é público por natureza) — inconsistência de flag sem
  nenhum log. E, como é string gerada (não arquivo), qualquer alteração futura de lógica pode
  introduzir injeção.
- **Mudança:** (1) responder com `Cache-Control: public, max-age=60` + ETag (a flag muda rápido;
  cache longo é errado); (2) mover o corpo do SDK para um **arquivo real** `public/sdk.js` (elimina
  o template string — ver `IMP-02`); (3) incluir versão no SDK.
- **Aceite:** `/sdk.js` responde com `Cache-Control` curto + ETag.
- **Verificação:**
  ```bash
  curl -sI http://localhost:3500/sdk.js | grep -iE 'cache-control|etag'
  ```

---

## 4. Bugs e defeitos funcionais

### BUG-02 · `atualizar` de flag inexistente devolve `null` em 200 · [P2]

- **Arquivo:** `src/loja.js:37-44`
- **Evidência:** sem validação de existência — se não houver campo permitido, retorna
  `this.obter(chave)` (linha 40); se houver, faz `UPDATE` (que não casa) e retorna `obter(chave)` →
  `null`, tudo com **200**.
- **Impacto:** o admin recebe `200 null` ao tentar editar flag inexistente — impossível distinguir
  "não existe" de "não mudou nada". Bug de API clássico (mesmo do `BUG-03` do `francos-commerce`).
- **Mudança:** se `obter(chave)` for `null` → `throw 404` (e mapear no `erro()` do `server.js`).
- **Aceite:** `PATCH /api/flags/inexistente` → `404`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X PATCH http://localhost:3500/api/flags/naoexiste \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"rollout":50}'   # 404
  ```

### BUG-03 · Rollout usa só 2 bytes do hash (16 bits) — distribuição enviesada · [P2]

- **Arquivo:** `src/loja.js:61`
- **Evidência:** `const valor = (hash[0] << 8 | hash[1]) / 65535 * 100;` — usa apenas os 2 primeiros
  bytes (16 bits) do SHA-256.
- **Impacto:** com 65.535 buckets, um canary de 1% (655 buckets) é muito grosso e a distribuição
  **não é uniforme** (os 2 primeiros bytes de SHA-256 são bons, mas a granularidade e a uniforme real
  dependem de mais bytes). Em population grande é aceitável; em population pequena (beta de 500
  usuários), o desvio pode ser de vários pontos percentuais do alvo — o canary não bate com o planejado.
- **Mudança:** usar os 4 primeiros bytes (32 bits → 4,3 bilhões de buckets):
  `(hash.readUInt32BE(0) / 0xFFFFFFFF) * 100`. Mantém determinismo e uniformidade.
- **Aceite:** distribuição uniforme — em 100k usuários sintéticos com rollout=10, o resultado fica
  dentro de ±0,5% de 10%.
- **Verificação:**
  ```bash
  node -e "const{createHash}=require('crypto');let on=0;for(let i=0;i<100000;i++){
  const h=createHash('sha256').update('flag:'+i).digest();const v=(h.readUInt32BE(0)/0xFFFFFFFF)*100;
  if(v<10)on++;} console.log((on/1000).toFixed(2)+'% esperado ~10%');"
  ```

### BUG-04 · `ativa` aceito como string ("false" é truthy) · [P2]

- **Arquivo:** `src/loja.js:37-43` (`ativa` está na `permitidos`; o valor vai direto ao UPDATE)
- **Evidência:** `atualizar` não valida tipo. `avaliar` checa `if (!flag.ativa)` (`loja.js:50`) —
  e SQLite devolve `"false"` (string, truthy) se foi inserido assim.
- **Impacto:** um admin (ou qualquer um, enquanto `SEC-01` estiver aberto) que envie
  `{"ativa": "false"}` **não desliga** a flag — o kill-switch parece funcionar mas não funciona.
  Pior: pode desativar um kill-switch real que sePrecisava ligado, num incidente.
- **Mudança:** (1) normalizar booleano no `atualizar`: aceitar `true`/`false` e converter para
  `1`/`0` (inteiro); rejeitar outros tipos com `400`; (2) `CHECK (ativa IN (0,1))` no schema;
  (3) o SDK/panel envia JSON booleano, não string.
- **Aceite:** `{"ativa":"false"}` → normaliza para `0` (desliga) **ou** `400` com regra clara.
- **Verificação:**
  ```bash
  curl -s -X PATCH http://localhost:3500/api/flags/x -H "Authorization: Bearer $T" \
    -H 'Content-Type: application/json' -d '{"ativa":"false"}' | jq .ativa   # 0 (ou erro 400)
  ```

### BUG-05 · Sem rate limit na rota de avaliação · [P2]

- **Arquivo:** `server.js:17-20`
- **Evidência:** rota pública, 1 query por chamada, sem limite.
- **Impacto:** a rota é a de **maior volume** (todo client chama em cada load/refresh). Sem rate
  limit, um laço (ou CDN mal configurado revalidando) satura o SQLite — a plataforma inteira de
  flags cai, e como ela decide outras features, o efeito é cascata.
- **Mudança:** rate limit amplo (ex.: 600/min por IP — o SDK consome bastante) + **cache** com TTL
  curto (ver `IMP-01`) para reduzir a carga de verdade, em vez de só barrar.
- **Aceite:** laço acima do teto → `429`; carga normal do SDK não é afetada.
- **Verificação:**
  ```bash
  for i in $(seq 1 700); do curl -s -o /dev/null "http://localhost:3500/api/flags/x/avaliar?usuario=$i"; done
  # algum 429 no fim
  ```
---

## 5. Qualidade: testes, arquitetura e observabilidade

### TEST-01 · Testes cobrem avaliação, não exposição nem admin · [P1]

- **Arquivo:** `test/loja-test.mjs` (72 linhas)
- **Evidência:** 8 testes cobrem criação, avaliação (kill-switch, atributo, rollout) — mas **nenhum**
  sobe o `server` e chama rota HTTP. A avaliação por atributo **passa no teste** porque chama
  `loja.avaliar(chave, {plano:'pro'})` direto no núcleo, com contexto completo — nunca exercita o
  `server.js:18` que só monta `{usuario}`. É por isso que o `BUG-01` está em produção.
- **Impacto:** os 2 P0 vivem nas rotas (sem middleware), sem teste; e o `BUG-01` **passa no teste**
  enquanto está quebrado em produção — teste verde que valida um caminho que não existe.
- **Mudança:** (1) testes de integração pela rota: CRUD sem token → 401 (após `SEC-05`);
  (2) `/avaliar` público devolve só `{on}` (após `SEC-02`); (3) **avaliação por atributo pela rota
  HTTP** — o teste que teria pegado o `BUG-01`; (4) `atualizar` de inexistente → 404.
- **Aceite:** `npm test` inclui os casos de rota; o de atributo falha antes do `BUG-01` e passa depois.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -3   # 12/12 (8 + 4 rota)
  ```

### IMP-01 · Sem cache — avaliação é 1 query por chamada, por request · [P2]

- **Arquivo:** `server.js:19` (`loja.avaliar` a cada request)
- **Evidência:** toda chamada de `/avaliar` faz `obter(chave)` → 1 SELECT no SQLite. O comentário da
  linha 16 ("rota pública do SDK") reconhece o alto volume, mas não há cache.
- **Impacto:** o SDK é chamado em **todo** load de página de todo cliente. Com N usuários, N queries
  por deploy, mais as revalidações. Em SQLite, é OK no começo; com o `BUG-05` (rate limit), sem
  cache o limite **derruba** tráfego legítimo em vez de absorver.
- **Mudança:** cache em memória com TTL curto (5-15 s) por `chave`, invalidado a cada escrita
  (`atualizar`/`criar`); `atualizar` deve limpar a entrada da chave. TTL curto porque flag muda por
  incidente.
- **Aceite:** N requisições no mesmo intervalo → 1 query ao banco; escrita invalida na hora.
- **Verificação:**
  ```bash
  # log de queries (ou contador) por 100 chamadas em 5s -> deve ser baixo
  # apos PATCH, a proxima avaliacao reflete a mudanca
  ```

### IMP-02 · SDK inline em string de template (injetável) · [P2]

- **Arquivo:** `server.js:33-40`
- **Evidência:** o corpo do SDK é uma template string dentro do código do servidor, não um arquivo.
- **Impacto:** (a) qualquer variável interpolada ali no futuro pode introduzir injeção (hoje não há
  interpolação, mas o padrão é frágil); (b) não passa por `eslint`/typecheck como arquivo real;
  (c) muda exige redeploy do servidor, não só do arquivo estático.
- **Mudança:** mover o corpo para `public/sdk.js` real, servido pela rota já existente
  (ver `SEC-06`) com cache headers e versão.
- **Aceite:** `public/sdk.js` existe; `server.js` só o serve.
- **Verificação:** `ls public/sdk.js && curl -s http://localhost:3500/sdk.js | head -1`

---

## 6. DevOps / Infra

### DEVOPS-01 · `featureflags.db` commitado no repo · [P1]

- **Arquivo:** `featureflags.db` (na raiz, trackeado)
- **Evidência:** `git ls-files | grep '\\.db$'` lista o arquivo; `.gitignore` (6 linhas) não o cobre.
  `server.js:11` usa `FF_DB || 'featureflags.db'`.
- **Impacto:** configuração de flags em produção versionada — inclui **segmentação e rollout**,
  o mesmo sigilo de negócio do `SEC-04`, agora também no histórico do git. E o `pull` sobrescreve o
  banco de dev.
- **Mudança:** `git rm --cached featureflags.db`; `*.db` no `.gitignore`.
- **Aceite:** nenhum `.db` no índice; testes verdes.
- **Verificação:**
  ```bash
  git ls-files | grep -c '\\.db$'   # 0
  npm test 2>&1 | tail -2
  ```

### DEVOPS-02 · Sem `.env.example` · [P3]

- **Arquivo:** *(ausente)* `.env.example` · `server.js:10-11`
- **Evidência:** lê `PORT` e `FF_DB`; após `SEC-05`, também `JWT_SECRET` e `ADMIN_*`.
- **Impacto:** baixo hoje; evita adivinhação após o `SEC-05`.
- **Mudança:** `.env.example` com `PORT`, `FF_DB`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- **Aceite:** exemplo versionado cobre todas as `process.env.*`.
- **Verificação:** `diff` entre `process.env.*` do código e as chaves do exemplo.

---

## 7. Documentação

### DOC-01 · README não explica o modelo de avaliação/trust · [P2]

- **Arquivo:** `README.md` (43 linhas)
- **Evidência:** o README descreve CRUD + avaliação + SDK, mas não explica: (a) que só `/avaliar` e
  `/sdk.js` são públicos (e que o resto **deve** exigir token); (b) que a segmentação por atributo
  precisa de contexto no request (que hoje não é repassado — `BUG-01`); (c) que `rollout` é
  determinístico por hash (mesmo usuário sempre cai no mesmo bucket).
- **Impacto:** quem integra o SDK não sabe o que a resposta garante (só `on`, depois do `SEC-02`);
  quem configura uma flag por atributo acha que funciona (não funciona); ninguém entende o modelo de
  rollout.
- **Mudança:** (1) tabela rota × público/token; (2) explicar o modelo de avaliação em 3 linhas
  (kill-switch → atributo → rollout determinístico); (3) documentar o que `/avaliar` devolve (só
  `on`); (4) exemplo de SDK.
- **Aceite:** a tabela de rotas e o modelo de avaliação estão no README.
- **Verificação:** `grep -n 'publico\|rollout\|determin' README.md`.

### DOC-02 · Falta `SECURITY.md` (flags são sigilo de negócio) · [P3]

- **Arquivo:** *(ausente)* `SECURITY.md`
- **Evidência:** tem `LICENSE` e `README`, nenhum guia de reporte nem política.
- **Impacto:** quem é concorrente da plataforma não tem canal para reportar exposição de flag
  (que revela estratégia de canary/beta). E as invariantes (só `/avaliar` público, resposta só `on`,
  contexto não confiável do cliente) não ficam escritas.
- **Mudança:** criar com: canal + as invariantes ("só avaliação é pública", "resposta pública só
  `on`", "atributo sensível vem de token, não de query") + ameaça "vazamento de estratégia de
  rollout".
- **Aceite:** arquivo existe com as 3 invariantes.
- **Verificação:** `ls SECURITY.md`

---

## 8. Ordem de execução (waves)

### Wave 1 — Fechar o painel (P0)
1. **`SEC-05`** — implementar auth (JWT + BCrypt + `admins`). Sem isso, nada abaixo.
2. **`SEC-01`** — `exigirAdmin` no CRUD de flags.
3. **`SEC-04`** — `exigirAdmin` na listagem.

> Depois da Wave 1, ninguém desliga flags sem token.

### Wave 2 — Corrigir exposição e quebrar a feature (P1)
4. **`BUG-01` / `SEC-03`** — segmentação por atributo funcionando **pela rota** (exige decidir
   origem do atributo: token vs query).
5. **`SEC-02`** — `/avaliar` público devolve só `{on}`.
6. **`BUG-02`** — 404 em `atualizar` de flag inexistente.
7. **`BUG-03`** — rollout com 32 bits.
8. **`BUG-04`** — normalizar `ativa`.
9. **`TEST-01`** — os 4 casos de rota (o de atributo pega o `BUG-01`).

### Wave 3 — Escala e higiene (P2)
10. **`IMP-01`** — cache com TTL curto + invalidação na escrita (reduz carga antes do rate limit).
11. **`BUG-05`** — rate limit na avaliação.
12. **`SEC-06`** — cache headers + ETag no `/sdk.js`.
13. **`IMP-02`** — SDK em arquivo real.
14. **`DEVOPS-01`** — tirar o `.db` do índice.

### Wave 4 — Registro (P3)
15. **`DOC-01`**, **`DEVOPS-02`**, **`DOC-02`**.

**Dependências que não podem ser invertidas:**
`SEC-05` antes de `SEC-01`/`SEC-04` · `SEC-02` antes de `TEST-01` (o teste afirma resposta só `on`) ·
`BUG-01` junto com `TEST-01` · `IMP-01` antes de `BUG-05` (cache absorve o que o limite barraria) ·
`SEC-06` junto com `IMP-02`.

---

## 9. Fora de escopo / riscos

| Item | Decisão | Motivo |
|---|---|---|
| Fechar `/avaliar` com token | **Não** | É o que o SDK consome; torná-la autenticada quebra o uso por design. O defeito é o **conteúdo** da resposta (`SEC-02`), não a abertura. |
| Migrar SQLite → Redis/Postgres | **Não** | O volume não justifica; cache (`IMP-01`) resolve. |
| Variantes de flag (A/B com múltiplos valores) | **Não** | Feature nova. O modelo booleano + rollout atende. |
| Webhook/event-stream ao mudar flag | **Não, ainda** | Seria o jeito certo de invalidar cache distribuído, mas o cache in-processa (`IMP-01`) cobre agora. |
| Assinatura de resposta da avaliação | **Não** | O cliente confia no servidor; assinatura só faz sentido com cache distribuído/CDN no meio. |

**Riscos desta execução:**

- **`SEC-05` exige criar o admin.** Sem `ADMIN_*` no env, o painel fica sem porta — semear no primeiro
  boot e falhar alto se não houver.
- **`SEC-02` quebra consumidores que leem `motivo`.** Se o painel/SDK já usa `motivo`, filtrar exige
  migrar o consumidor — grep por `motivo` antes.
- **`BUG-01` (atributo pela rota) tem decisão de confiança embutida.** Se o atributo vier de query
  string, o cliente **mente** sobre o próprio plano e ativa feature premium. Por isso o item exige
 权衡 (atributo sensível vem de token assinado). Escolha consciente, não默认 query.
- **`BUG-03` (32 bits) muda o bucket de quem já estava no canary.** Quem estava dentro pode sair e
  vice-versa — aceitar como mudança de rollout (comunicar).
- **`DEVOPS-01` antes de criar teste que escreva banco**, senão o teste commita o `.db`.

---

## 10. Definição de pronto (DoD)

**Segurança**
- [ ] `SEC-05` — JWT + BCrypt + `admins`; sem env, falha alto
- [ ] `SEC-01` — CRUD de flags exige admin
- [ ] `SEC-04` — `GET /api/flags` exige admin
- [ ] `SEC-02` — `/avaliar` público devolve só `{on}`
- [ ] `SEC-06` — `/sdk.js` com `Cache-Control` curto + ETag

**Funcional**
- [ ] `BUG-01`/`SEC-03` — segmentação por atributo ativa pela rota com contexto correto
- [ ] `BUG-02` — `atualizar` de inexistente → `404`
- [ ] `BUG-03` — rollout com 32 bits; distribuição uniforme (desvio < ±0,5%)
- [ ] `BUG-04` — `ativa` string normalizada ou `400`
- [ ] `BUG-05` — laço de avaliação acima do teto → `429`

**Testes e qualidade**
- [ ] `TEST-01` — 12/12 (8 + 4 rota; o de atributo pega o `BUG-01`)
- [ ] `IMP-01` — cache invalida na escrita; N chamadas → poucas queries
- [ ] `IMP-02` — SDK em `public/sdk.js`

**Infra e documentação**
- [ ] `DEVOPS-01` — nenhum `.db` no índice
- [ ] `DEVOPS-02` — `.env.example` com as 5 variáveis
- [ ] `DOC-01` — README com tabela de rotas + modelo de avaliação
- [ ] `DOC-02` — `SECURITY.md` com as 3 invariantes

**Validação final:**
```bash
npm test 2>&1 | tail -2   # 12/12
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3500/api/flags   # 401
curl -s 'http://localhost:3500/api/flags/x/avaliar?usuario=u' | jq 'keys'  # ["on"]
git ls-files | grep -c '\\.db$'   # 0
```

---

*Fim do plano. Gerado por leitura direta do código em 2026-10-02. Nenhum item já estava corrigido*
*— todos apontam para defeitos ainda presentes.*
