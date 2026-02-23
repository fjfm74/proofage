# Deploy Replit (guia novato)

Usaremos siempre estos nombres:
- `Servidor Replit (pruebas)`
- `Terminal Servidor Replit`
- `Terminal Comandos Replit`

## 1) Subir proyecto a GitHub
Primero crea un repo vacio en GitHub (sin README).

Luego en tu Mac:
```bash
cd "/Users/francescfernandez/Documents/New project/proofage-rail"
git init
git add .
git commit -m "proofage rail starter"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 2) Importar en Replit
1. Replit -> `Create Repl`.
2. `Import from GitHub`.
3. Pega URL de tu repo.

## 3) Configurar secretos en Replit
En `Secrets`, crea:
- `PROOFAGE_DATABASE_URL` = `file:./services/proof-api/dev.db`
- `VERIFIER_CALLBACK_SECRET` = cadena larga privada
- `JWT_SIGNING_KEY` = cadena larga (32+ chars)
- `BOOTSTRAP_API_KEY` = api key inicial larga

Opcional:
- `ASSERTION_TTL_SECONDS` = `600`

## 4) Arrancar servidor
Pulsa `Run`.

El proyecto usa `.replit` con:
```text
npm run replit:start
```

## 5) Probar endpoint health
En `Terminal Comandos Replit`:
```bash
curl https://TU_REPL_URL/health
```

## 6) Notas importantes
- Este despliegue es de pruebas (SQLite local).
- Para `Servidor Replit (real)` migraremos a Postgres/Supabase.
