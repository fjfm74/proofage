# Quickstart Codex (novato)

## 1) Entra al proyecto
`cd "/Users/francescfernandez/Documents/New project/proofage-rail"`

## 2) Inicializa backend
```bash
npm install
cp .env.example .env
npm run setup:api
npm run dev:api
```

## 3) Prueba flujo de extremo a extremo
```bash
export API_KEY="proofage_demo_key_change_me"
export VERIFIER_SECRET="dev_verifier_secret_change_me"

curl -X POST http://localhost:8787/v1/proof/request \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"subjectRef":"user_123","minAge":18}'
```

## 4) Valida la assertion JWT (ejemplo relying party)
```bash
export PROOF_ID="REEMPLAZA_CON_ID_REAL"
export NONCE="nonce_$(date +%s)"

curl -X POST http://localhost:8787/v1/proof/callback \
  -H "Content-Type: application/json" \
  -H "x-verifier-secret: $VERIFIER_SECRET" \
  -d "{\"proofRequestId\":\"$PROOF_ID\",\"result\":\"passed\",\"verifierRef\":\"verif_001\"}"

ASSERTION=$(curl -s -H "x-api-key: $API_KEY" \
  "http://localhost:8787/v1/proof/assertion/$PROOF_ID?nonce=$NONCE" | \
  sed -n 's/.*"assertion":"\\([^"]*\\)".*/\\1/p')

curl -X POST http://localhost:8787/v1/relying/verify-assertion \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{\"assertion\":\"$ASSERTION\",\"requiredMinAge\":18,\"expectedNonce\":\"$NONCE\",\"expectedSubjectRef\":\"user_123\"}"
```

## 5) Pide a Codex tareas concretas
Ejemplos:
- `crea tests de integracion para proof-api`
- `migra sqlite a postgres con prisma migrations`
- `anade endpoint de webhooks para merchants`
- `crea un frontend minimo para merchants`

## Regla de oro
No mezclar demasiadas cosas en una sola orden. Mejor tareas pequenas y verificables.

## 6) Gestiona API keys del merchant
```bash
curl -X POST http://localhost:8787/v1/merchant/api-keys \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"label":"backend-main"}'

curl -H "x-api-key: $API_KEY" \
  http://localhost:8787/v1/merchant/api-keys
```
