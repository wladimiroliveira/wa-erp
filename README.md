# wa-erp

Aplicação do `wa-system`: front-end React 19 e API REST no mesmo projeto Next.js (App Router).
Substitui o par `wa-web` + `wa-api`. O app mobile (`wa-system/app`) continua gerando seu cliente
a partir de `openapi.json`.

- As telas vivem em `src/app/(app)` (rotas, Server Components) e `src/features` (componentes client
  e Server Actions). Uma tela lê dados chamando o módulo em `src/server` direto e grava por action.
- A API REST vive em `src/app/v1/**/route.ts`, um arquivo por caminho, cada método declarado com
  `apiHandler`. As regras ficam em `src/server/modules/<x>/<x>.service.ts`, as mesmas que as
  actions usam.
- O banco é Postgres via Prisma (`prisma/schema.prisma`, migrações em `prisma/migrations`).

## Ambiente

Nenhum arquivo `.env` é versionado. Para desenvolver, copie o exemplo e suba o Postgres:

```bash
cp .example.env .env
npm install
npm run services:up
npm run db:migrate:dev
npm run db:seed
npm run dev
```

## Scripts

| Comando                    | O que faz                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run dev`              | servidor de desenvolvimento (front e API)                          |
| `npm run build`            | build de produção                                                  |
| `npm test`                 | testes unitários                                                   |
| `npm run test:integration` | testes contra o Postgres (`TEST_DATABASE_URL`)                     |
| `npm run test:all`         | tudo                                                               |
| `npm run typecheck`        | checagem de tipos                                                  |
| `npm run db:migrate:dev`   | cria e aplica migrações no banco de desenvolvimento                |
| `npm run db:seed`          | cria o papel Owner e o primeiro usuário (`OWNER_*` no `.env`)      |
| `npm run openapi:dump`     | regrava `openapi.json` a partir dos route handlers em `src/app/v1` |

Os testes de integração precisam de `TEST_DATABASE_URL`; eles aplicam as migrações nesse schema e
truncam as tabelas entre os testes.

## Sessão

Há dois jeitos de estar autenticado, sobre o mesmo usuário e as mesmas permissões:

- **Web**: cookie `wa_session`, httpOnly, com um token opaco guardado como hash na tabela `sessions`.
  O `src/proxy.ts` manda quem não tem cookie para `/login`; o layout de `(app)` valida a sessão no banco
  a cada requisição (`src/server/auth/current-user.ts`). Telas e Server Actions nunca chamam `/v1`.
- **API `/v1`**: bearer JWT de curta duração com refresh token, para o app mobile.

Trocar a senha, inativar um usuário ou resetar a senha dele revoga as duas coisas de uma vez
(`revokeAllAccess`). O rate limit do login (5 tentativas por minuto por endereço e usuário) vale
para o formulário web e para `POST /v1/sessions/signin`, com o mesmo contador em memória.

## Contrato da API

`openapi.json` é gerado, não escrito à mão: cada `route.ts` em `src/app/v1` declara seus schemas
uma vez e o caminho do arquivo é a rota. O app mobile (`swagger_parser`) gera seu cliente desse
arquivo, e um teste unitário falha quando ele sai de sincronia com as rotas. Mudou uma rota: rode
`npm run openapi:dump` e commite o arquivo. O documento também é servido em `GET /v1/openapi.json`.

## Implantação

- **Vercel.** `postinstall` roda `prisma generate`; o schema declara o alvo `rhel-openssl-3.0.x`.
  As migrações não rodam no build: aplique-as com `npm run db:migrate:deploy` como passo de
  release, ou configure o comando de build como `npx prisma migrate deploy && next build`.
- **Postgres com pool.** Funções serverless abrem conexões por instância; use um banco com pooler
  (Neon, Supabase, PgBouncer) na `DATABASE_URL`.
- **HTTPS.** O cookie de sessão é `secure` em produção e só chega por HTTPS.
- **Rate limit do login.** Vive na memória de cada instância, como no `wa-api`. É um freio a
  varreduras de senha, não uma garantia global.
- **Variáveis.** `DATABASE_URL`, `JWT_SECRET`, `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS`
  (também é a vida do cookie de sessão). Validadas na primeira requisição, não no build.

## App mobile

O cliente Dart é gerado do `openapi.json` deste repositório. Em `wa-system/app/swagger_parser.yaml`,
aponte `schema_path` para `../wa-erp/openapi.json` (ou para `GET /v1/openapi.json` do serviço) e
regenere. O contrato é o mesmo do `wa-api`; as diferenças no documento são de gerador (campo
`security` por operação, respostas 204 sem `content`, ordem dos parâmetros).

## Testes de ponta a ponta

Não há. As páginas (Server Components) ficam cobertas pelos testes dos services e das actions;
os componentes client, pelos testes com as actions simuladas. Um Playwright contra o `next dev`
com Postgres é o próximo passo natural.
