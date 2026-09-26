# FeatureFlags — Lean Feature Flag Platform

![Status](https://img.shields.io/badge/M1-funcionando%20(8%2F8%20testes)-brightgreen)
![CI](https://img.shields.io/badge/CI-test%20%2B%20license%20check-blue)
![Node](https://img.shields.io/badge/Node-%3E%3D18-green?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

A lean feature-flag platform: boolean/percentage evaluation, JS SDK with cache + kill-switch,
admin panel (toggle, % rollout, attribute targeting) and live updates via WebSocket.

> 🇧🇷 Plataforma enxuta de feature flags: avaliação booleana/percentual, SDK JS com cache
> e kill-switch, painel admin e updates ao vivo via WebSocket.

## Features

- [x] **M1a** — Flags API (CRUD + evaluation: boolean/percentage/attribute) + SDK JS served at `/sdk.js`
- [x] **M1b** — Admin panel (toggle, % rollout, targeting) + 8/8 evaluation tests
- [x] Kill-switch, deterministic hash rollout (same user → same result), 50% distribution proven
- [ ] **M2** — ws streaming of updates, gradual canary ramps over time

## Quick start

```bash
docker compose up   # painel em http://localhost:3500
```

```bash
# cria uma flag e avalia
curl -X POST http://localhost:3500/api/flags -H "Content-Type: application/json" \
  -d '{"chave":"novo-checkout","rollout":100}'
curl "http://localhost:3500/api/flags/novo-checkout/avaliar?usuario=maria"
# => {"on":true,"motivo":"rollout-100"}
```

## Built with

- Gating patterns from my agendaflow-saas project; JWT/SQLite from api_mongodb_query_money
- Concepts reference: [growthbook](https://github.com/growthbook/growthbook) (8.4k⭐),
  [flagsmith](https://github.com/Flagsmith/flagsmith) (6.6k⭐)

## License

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation))
