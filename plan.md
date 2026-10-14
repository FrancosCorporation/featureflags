# Plan — featureflags

## 1. Visão geral

- **Nome:** featureflags — painel de feature flags
- **Descrição:** serviço Node 22+ (ESM) com painel autenticado (JWT), rollout determinístico e contexto de avaliação assinado; persistência SQLite; Helmet/CSP.
- **Estado atual:** SEC-01..06, BUG-02..05, IMP-01/02, DEVOPS-02 e docs confirmados em HEAD sincronizado (revisão 2026-10-11); CI modernizada nesta sessão.

## 2. Arquitetura e tecnologias

- Node (ESM), express 4, helmet 8, jsonwebtoken 9, bcryptjs 2; SQLite local.
- CI: suíte + licenças; **modernizada nesta sessão** (Ubuntu 24.04, Actions v7, Node 22/24, `npm ci`, gate audit).

## 3. Funcionalidades existentes

- [x] Painel autenticado + rollout determinístico + contexto assinado — confirmado na revisão.
- [x] CI — **modernizada nesta sessão**.

## 4. Objetivos futuros

- **OBJ-01 (P2, concluído nesta sessão):** CI previsível com gates.
- **OBJ-02 (P3, recomendação):** atualizar bcryptjs 2→3 (alinha com o workspace).
- **OBJ-03 (P3, recomendação):** SDK JS mínimo publicável (ex.: página de exemplo do cliente) — somente se houver consumo externo.

## 5–7. Melhorias / Roadmap / Backlog

Fases 1–3 concluídas; backlog: OBJ-02, OBJ-03 (P3).

## 8. Riscos e pendências

- `bcryptjs` 2.x mantido por ora (mudança de major exige rodar a suíte localmente, vedada nesta esteira).
- TEST-01 (validação comportamental do painel) segue pendente fora da esteira.

## 9. Ideias adicionais

- Webhook de mudança de flag para invalidação de caches de clientes.

---
*(Gerado em 2026-10-14 pelo agente orquestrador)*
