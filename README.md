# FeatureFlags

Serviço simples de feature flags em Node.js, Express e SQLite. O painel administra as flags, enquanto uma API pública avalia o resultado booleano para a aplicação cliente.

## Requisitos

- Node.js 22.5 ou mais recente (`node:sqlite` é usado pelo núcleo)
- npm
- Docker e Docker Compose, se executar em contêiner

## Configuração local

```bash
cp .env.example .env
```

Preencha `JWT_SECRET` e `EVALUATION_SECRET` com segredos diferentes, cada um com pelo menos 32 bytes. Gere valores com:

```bash
openssl rand -hex 32
```

Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` para criar a primeira conta administrativa. A senha deve ter entre 12 e 128 caracteres. Instale e inicie:

```bash
npm ci
node --env-file=.env server.js
```

O painel fica em <http://localhost:3500>. Após a criação do primeiro administrador, as variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD` podem sair do ambiente. Os dois segredos continuam obrigatórios.

## Docker Compose

Defina os mesmos valores em `.env` e execute:

```bash
docker compose up --build
```

Por padrão, o serviço escuta em `127.0.0.1:3500`. O banco SQLite fica no volume persistente `dados`. Para publicar externamente, use um proxy reverso com TLS e controles de acesso adequados.

## Como a avaliação funciona

1. O kill-switch (`ativa`) desliga a flag.
2. Se houver segmentação por atributo, o atributo assinado precisa corresponder ao valor-alvo.
3. Sem alvo por atributo, o rollout percentual usa hash determinístico de chave e usuário; o mesmo identificador continua no mesmo grupo.

O identificador `usuario` enviado pelo cliente serve para rollout e pode ser escolhido pelo próprio cliente. Ele não deve representar uma permissão ou plano pago. Para atributos confiáveis, o backend da aplicação emite um JWT curto com a identidade e os atributos; o segredo `EVALUATION_SECRET` fica apenas nesse backend.

Exemplo de emissão no backend confiável:

```js
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: user.id, attributes: { plan: user.plan } },
  process.env.EVALUATION_SECRET,
  { algorithm: 'HS256', issuer: 'featureflags-context', audience: 'featureflags-evaluation', expiresIn: '5m' }
);
```

O navegador pode então chamar o SDK:

```html
<script src="/sdk.js"></script>
<script src="/meu-app.js"></script>
```

Em `meu-app.js`:

```js
const resultado = await FeatureFlags.avaliar('novo-checkout', { usuario: 'user-123' });
// resultado contém apenas { on: boolean }
```

Para uma flag por atributo, passe o token emitido pelo backend como `contexto.token`. A rota não aceita atributos de segmentação em query string. O token de avaliação precisa de `sub`, `attributes` com valores textuais e os campos `issuer` e `audience` mostrados acima.

## API

| Método e caminho | Acesso | Uso |
|---|---|---|
| `POST /api/admin/login` | Público, com limite de tentativas | Entrar no painel |
| `GET /api/flags` | Administrador | Listar estratégia e configuração das flags |
| `POST /api/flags` | Administrador | Criar flag |
| `PATCH /api/flags/:chave` | Administrador | Editar rollout, estado, descrição ou alvo |
| `GET /api/flags/:chave/avaliar` | Público, limitado por IP | Avaliar por rollout e usuário |
| `GET /sdk.js` | Público | Carregar o SDK, com ETag e cache curto |

As rotas de listagem e gestão exigem `Authorization: Bearer <token>`. O token de painel expira em 12 horas. A avaliação pública responde apenas `{ "on": true|false }`, sem chave, motivo, bucket, rollout ou configuração interna. As respostas de login, gestão e avaliação usam `Cache-Control: no-store` para não misturar usuários nem armazenar tokens em caches intermediários.

O SDK e a API usam a mesma origem; CORS não está habilitado. O cadastro de flags não oferece remoção física. Avaliações usam cache de configuração em memória por até 10 segundos, invalidado ao editar a flag. A rota pública permite até 600 avaliações por minuto e IP por processo.

## Dados locais

`FF_DB` define o caminho do banco; por padrão, é `featureflags.db`. O SQLite contém a configuração das flags e dados de contas administrativas. Arquivos de banco, `.env` e segredos ficam fora do Git. Faça backup do volume antes de atualizações importantes.

## Desenvolvimento

```bash
npm test
```

A suíte existente cobre o núcleo de avaliação. As rotas HTTP, a autenticação e a emissão de tokens de contexto ainda não têm cobertura automatizada.

## Segurança

Consulte [SECURITY.md](SECURITY.md) para os controles, limites e instruções de relato privado.

## Roadmap

Atualizações em tempo real por WebSocket e rampas graduais continuam fora da versão atual.

## Licença

MIT — Rodolfo Franco ([FrancosCorporation](https://github.com/FrancosCorporation)).
