# AGENTS.md - ProofAge Rail

## Mision
Construir una infraestructura de prueba de mayoria de edad (18+) que sea reutilizable entre plataformas y minimice datos personales.

## Principios obligatorios
- Privacidad por defecto: no almacenar fotos, DNIs o fecha de nacimiento completa.
- Minimizar datos: guardar solo identificadores tecnicos, estado de prueba y metadatos operativos.
- Auditabilidad: toda decision de verificacion debe poder trazarse con timestamp y fuente.
- API-first: cualquier funcionalidad nueva debe exponerse por API versionada (`/v1`).

## Arquitectura inicial
- `services/proof-api`: backend principal (Fastify + TypeScript).
- `apps/merchant-dashboard`: panel para clientes (placeholder).
- `docs`: decisiones de arquitectura y roadmap.

## Convenciones
- TypeScript estricto.
- Zod para validar entrada/salida.
- Errores con formato JSON consistente: `{ code, message, details? }`.
- IDs con `crypto.randomUUID()`.

## Seguridad
- Secretos siempre en variables de entorno.
- Nunca loggear tokens completos ni headers de autorizacion.
- Preparar capa de adaptadores para proveedores de verificacion (evitar lock-in).

## Definition of Done (por cambio)
- Compila (`npm run check:api`).
- Si hay logica nueva, incluir al menos test unitario o de integracion.
- Actualizar docs si cambia contrato API.
