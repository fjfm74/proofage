# ProofAge Rail (starter)

Proyecto base para construir una API universal de validacion de edad con privacidad.

## Objetivo del MVP
- Emitir solicitudes de verificacion (`proof request`).
- Recibir resultado de un verificador externo.
- Exponer estado y asercion JWT de edad sin guardar PII sensible.

## Requisitos
- Node.js 20+
- npm 10+

## Arranque rapido
1. `cd "/Users/francescfernandez/Documents/New project/proofage-rail"`
2. `npm install`
3. `cp .env.example .env`
4. `npm run setup:api`
5. `npm run dev:api`
6. Probar health: `curl http://localhost:8787/health`

## Endpoints MVP
- `POST /v1/merchant/api-keys` (requiere `x-api-key`)
- `GET /v1/merchant/api-keys` (requiere `x-api-key`)
- `POST /v1/merchant/api-keys/:apiKeyId/revoke` (requiere `x-api-key`)
- `POST /v1/proof/request` (requiere `x-api-key`)
- `POST /v1/proof/callback` (requiere `x-verifier-secret`)
- `GET /v1/proof/status/:proofRequestId` (requiere `x-api-key`)
- `GET /v1/proof/assertion/:proofRequestId` (requiere `x-api-key`)
- `POST /v1/relying/verify-assertion` (requiere `x-api-key`)

## Ejemplo rapido con curl
```bash
export API_KEY="proofage_demo_key_change_me"
export VERIFIER_SECRET="dev_verifier_secret_change_me"

curl -X POST http://localhost:8787/v1/proof/request \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"subjectRef":"user_123","minAge":18}'
```

## Gestion de API keys (merchant self-service)
```bash
curl -X POST http://localhost:8787/v1/merchant/api-keys \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"label":"backend-main"}'
```

```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:8787/v1/merchant/api-keys
```

```bash
export TARGET_KEY_ID="REEMPLAZA_CON_APIKEYID"

curl -X POST http://localhost:8787/v1/merchant/api-keys/$TARGET_KEY_ID/revoke \
  -H "x-api-key: $API_KEY"
```

```bash
export PROOF_ID="REEMPLAZA_CON_EL_ID"

curl -X POST http://localhost:8787/v1/proof/callback \
  -H "Content-Type: application/json" \
  -H "x-verifier-secret: $VERIFIER_SECRET" \
  -d "{\"proofRequestId\":\"$PROOF_ID\",\"result\":\"passed\",\"verifierRef\":\"verif_001\"}"

curl -H "x-api-key: $API_KEY" \
  http://localhost:8787/v1/proof/status/$PROOF_ID

NONCE="nonce_$(date +%s)"
curl -H "x-api-key: $API_KEY" \
  "http://localhost:8787/v1/proof/assertion/$PROOF_ID?nonce=$NONCE"
```

## Verificar assertion (relying party demo)
```bash
NONCE="nonce_$(date +%s)"
ASSERTION=$(curl -s -H "x-api-key: $API_KEY" \
  "http://localhost:8787/v1/proof/assertion/$PROOF_ID?nonce=$NONCE" | \
  sed -n 's/.*"assertion":"\([^"]*\)".*/\1/p')

curl -X POST http://localhost:8787/v1/relying/verify-assertion \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"assertion\":\"$ASSERTION\",\"requiredMinAge\":18,\"expectedNonce\":\"$NONCE\",\"expectedSubjectRef\":\"user_123\"}"

# Si repites exactamente la misma verificacion, debe devolver ASSERTION_REPLAYED
curl -X POST http://localhost:8787/v1/relying/verify-assertion \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"assertion\":\"$ASSERTION\",\"requiredMinAge\":18,\"expectedNonce\":\"$NONCE\",\"expectedSubjectRef\":\"user_123\"}"
```

## Como trabajar con Codex en este proyecto
Cuando estes en esta carpeta, pide tareas concretas, por ejemplo:
- `crea tests para los endpoints del proof-api`
- `migra PROOFAGE_DATABASE_URL a postgres y añade migraciones`
- `integra Stripe para billing por consumo`
- `crea dashboard para merchants en apps/merchant-dashboard`

Codex usara `AGENTS.md` de este proyecto para mantener consistencia tecnica.

## Deploy en Replit (pruebas)
Nombres fijos:
- `Servidor Replit (pruebas)`: el Repl que ejecuta esta API.
- `Terminal Servidor Replit`: consola donde corre `npm run replit:start`.
- `Terminal Comandos Replit`: consola para `curl`.

Pasos:
1. Sube este proyecto a un repositorio GitHub.
2. En Replit: `Create Repl` -> `Import from GitHub` -> selecciona el repo.
3. En `Secrets` de Replit, crea:
   - `PROOFAGE_DATABASE_URL=file:./services/proof-api/dev.db`
   - `VERIFIER_CALLBACK_SECRET=pon_un_valor_largo`
   - `JWT_SIGNING_KEY=pon_un_valor_largo_32+`
   - `BOOTSTRAP_API_KEY=pon_un_api_key_inicial_larga`
4. Pulsa `Run` (usa `.replit` y lanza `npm run replit:start`).
5. Prueba salud:
   - `curl https://TU_REPL_URL/health`
