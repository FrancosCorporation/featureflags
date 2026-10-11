# Segurança

## Reportar vulnerabilidades

Use **Report a vulnerability** na aba **Security** deste repositório no GitHub para enviar um relato privado. Não publique detalhes exploráveis em issues públicas. Inclua impacto, passos para reproduzir e uma forma segura de contato para coordenar a correção.

## Invariantes de segurança

- Entre as rotas da API, somente o login e a avaliação são públicos. Listagem, criação e edição de flags exigem JWT administrativo; os arquivos da interface e o SDK são públicos.
- A avaliação pública devolve somente `{ on }`; não expõe nomes de flags, motivos, buckets, rollout, atributos nem valores-alvo.
- A identidade de rollout enviada em `usuario` pode ser escolhida pelo cliente e não concede autorização.
- Atributos de segmentação vêm exclusivamente de JWT assinado por um backend confiável. A rota não lê atributos da query string.
- `JWT_SECRET` e `EVALUATION_SECRET` são segredos independentes, obrigatórios e com pelo menos 32 bytes. O primeiro assina tokens administrativos; o segundo valida contexto de avaliação com emissor e audiência específicos.

## Controles implementados

- A senha do administrador usa BCrypt. Não há cadastro administrativo público; a primeira conta é criada por `ADMIN_EMAIL` e `ADMIN_PASSWORD` no primeiro início.
- JWTs administrativos usam HS256, papel `admin`, emissor e audiência restritos e expiram em 12 horas.
- JWTs de avaliação exigem `sub`, atributos textuais validados, emissor `featureflags-context`, audiência `featureflags-evaluation` e expiração de até 15 minutos emitida pelo backend confiável.
- Helmet configura cabeçalhos de segurança e uma política compatível com HTML, CSS e JavaScript externos. CORS não está habilitado.
- Login e avaliação têm limites em memória por IP. O estado é local ao processo e reinicia quando o serviço reinicia.
- A avaliação consulta configurações com cache de 10 segundos, invalidado em escritas administrativas. A resposta por usuário não é cacheada.
- O painel escreve dados dinâmicos com APIs do DOM e `textContent`; a configuração de flags não é inserida como HTML.

## Operação

- Gere e armazene os segredos fora do navegador, do Git, das imagens e dos logs. O backend de produto que assina JWTs de avaliação precisa guardar `EVALUATION_SECRET`; nunca envie esse segredo ao SDK.
- Use TLS para acesso externo e restrinja o painel administrativo. O Compose publica em loopback por padrão.
- Mantenha `trust proxy` desabilitado, a menos que a implantação configure proxies conhecidos explicitamente. O endereço IP é usado pelo limitador.
- Proteja e faça backup do volume SQLite. O banco contém configuração de rollout e hashes de senha.
- Como os limites são locais a cada processo, implantações com múltiplas réplicas precisam de limitador distribuído antes de depender deles contra abuso coordenado.
- Alterar o rollout de 16 para 32 bits pode mudar o grupo de alguns usuários existentes; planeje essa mudança como nova distribuição de canary.

## Escopo

O SDK e a API de avaliação são destinados a integrações same-origin. Avaliação de flags não substitui controles de autorização no backend do produto. Segredos e atributos sensíveis nunca devem ser enviados em query strings ou expostos ao navegador.
