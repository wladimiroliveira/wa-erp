# wa-erp

Front-end e API do `wa-system` num só projeto Next.js (App Router). Substitui `wa-api` + `wa-web`;
o app Flutter continua consumindo a API REST em `/v1`, gerada em `openapi.json`.

## Mapa

- `src/app/v1/**/route.ts`: API REST (route handlers nativos). Um `route.ts` por caminho, cada método
  declarado com `apiHandler` (`src/server/http/handler.ts`). O caminho do arquivo é a rota.
- `src/app/(app)/**`: telas. `page.tsx` e `layout.tsx` são Server Components; buscam dados chamando
  o módulo em `src/server` direto, nunca via HTTP.
- `src/features/<x>/`: componentes client da tela e `actions.ts` (Server Actions) da feature.
- `src/server/modules/<x>/`: `schemas` (zod, importável pelo client: sem `@prisma/client`),
  `repository` (Prisma), `service` (regras). REST e actions chamam o mesmo service.
- `src/server/auth/`: bearer JWT (REST) e sessão em cookie httpOnly (web) sobre o mesmo usuário.
  `src/proxy.ts` só olha se o cookie existe; `requireUser()` valida no banco a cada requisição.
- `src/app/(app)/layout.tsx` lê a sessão e os layouts de tabela uma vez e alimenta `SessionProvider`
  e `TableLayoutsProvider`; componentes client leem dali, nunca buscam.
- `src/shared/`: enums e tipos compartilhados entre server e client.
- `openapi.json` é gerado (`npm run openapi:dump`), nunca editado à mão. Mudou rota: regenere e commite.

## Regras locais

- Regra de negócio vive no `service`, nunca no `route.ts` nem na action: os dois são adaptadores.
- Toda rota declara `auth` explicitamente; nenhuma nasce pública por omissão.
- Testes: `npm test` (web em jsdom + api, sem banco), `npm run test:integration` (Postgres em
  `TEST_DATABASE_URL`). Tela client testa com as actions simuladas via `vi.mock`; página server
  component não tem teste RTL.
- Tipos do front vêm de `src/lib/api.ts`, só `import type` das schemas zod. Fábricas de teste em
  `src/tests/samples.ts`.
