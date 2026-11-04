# Plan — Partes 5 a 8 (Redis/BullMQ, Seguridad, CQRS/Pub-Sub, PM2) · portafolio-cripto

El plan de las Partes 3 y 4 (ya en `main`) está archivado en [PLAN-PARTES-3-4.md](PLAN-PARTES-3-4.md).

## Estado

- [x] Sesiones 0 a 7 — Partes 3 y 4 (en `main`, commit `3297718`)
- [x] Sesión 8 — Planificación de las Partes 5 a 8
- [x] Sesión 9 — Redis: infraestructura, caché, preferencias y ranking
- [x] Sesión 10 — BullMQ: cola de reportes, worker y cierre de la **Parte 5** (**Parte 5 en `main`**)
- [x] Sesión 11 — Auth0 y middleware JWT (JWKS) (probada con Auth0 real el 2026-10-31)
- [x] Sesión 12 — RBAC, modo pánico y cierre de la **Parte 6** (**Parte 6 en `main`**)
- [x] Sesión 13 — CQRS: comandos, consultas y publicación de eventos
- [ ] Sesión 14 — Pub/Sub: suscriptores y cierre de la **Parte 7**
- [ ] Sesión 15 — PM2 cluster, salud, cierre ordenado y monitor de reinicios
- [ ] Sesión 16 — Pruebas de carga y cierre de la **Parte 8**

## Contexto

Las Partes 3 y 4 están en `main`: pipelines (Zod, Winston, Jest), MySQL + Sequelize + Umzug para
`activos`, MongoDB + Mongoose para la auditoría, todo en Docker Compose. 158 tests, Newman 29
requests en verde.

Letras nuevas en `Contextos/` (cuatro PDF) y dos ejemplos:

- **Parte 5** — Redis (cliente oficial): caché con `set/get` + TTL, preferencias con
  `hSet/hGetAll`, cola `report-queue` con Bull, `POST /assets/report` → 202, worker que registra
  en la auditoría, eventos `completed/failed` en Winston, `on('error')` + `connect()`, Redis en
  compose. Bonus: comando atómico (`INCR`).
- **Parte 6** — JWT con IdP (opción B, recomendada) validando contra JWKS, 401 si es inválido,
  RBAC AUDITOR/TRADER/ADMIN desde el payload. Bonus: Panic Mode en Redis (403 a escrituras).
- **Parte 7** (el PDF dice "Parte 6" en el título, es un error de la letra) — CQRS: comandos
  solo validan y persisten en MySQL; consultas leen de Redis y caen a MySQL. Pub/Sub: publicar
  en `asset-updates`; suscriptor que actualiza caché, invalida rankings/contadores y audita en
  Mongo. Bonus: segundo suscriptor de Whale Alert + reto (suscriptor caído vs Bull). README: por
  qué CQRS mejora el rendimiento.
- **Parte 8** — PM2 `ecosystem.config.js` (`instances: "max"`, `autorestart`,
  `max_memory_restart`), `GET /health` con MySQL/Mongo/Redis, cierre ordenado con SIGINT
  (incluido Bull), `pm2 monit`, log crítico si una instancia reinicia > 5 veces/min, prueba de
  carga con 100 usuarios (lectura y escritura), comparación una instancia vs cluster.
- **Ejemplos**: `Ejemplo-pub-sub/` (API + 2 suscriptores en contenedores separados, misma
  imagen, dos conexiones por suscriptor, Redis 7.4 con contraseña y AOF) y `pm2-lab/`
  (`ecosystem.config.cjs`, `pm2-runtime` en Docker, `wait_ready`, cierre ordenado, k6 en un
  servicio de compose con perfil). Se toman como molde directo.

### Decisiones tomadas en esta sesión

| Tema | Decisión | Quién |
|---|---|---|
| Identidad (Parte 6) | **Auth0** (opción B). La API valida con JWKS; los roles van en un claim propio que agrega una Action | Estudiante |
| Cola (Parte 5) | **BullMQ** en lugar de Bull: Bull está en modo mantenimiento (última versión dic-2024) y sus autores recomiendan BullMQ | Estudiante, a propuesta de Claude |
| Nombres | En español, con tabla "letra → proyecto" en el README (mismo criterio que en la Parte 3) | Estudiante |
| Orden | Una parte por vez; cada parte se cierra en `main` antes de empezar la siguiente | Estudiante |
| Procesos | Worker y suscriptores son **procesos aparte** (misma imagen, otro comando), como en los ejemplos. Es lo que permite el cluster de la Parte 8 sin duplicar trabajo | Claude |
| Bonus | Se hacen todos (INCR, Panic Mode, Whale Alert + reto) | Claude, a confirmar |
| Sesión de plan | Opus 5.5 · esfuerzo extra alto · modo plan | Estudiante |

### Tabla de nombres (va al README)

| En la letra | En el proyecto |
|---|---|
| cola `report-queue` | `cola-reportes` |
| `POST /assets/report` | `POST /api/activos/reporte` (+ `GET /api/reportes/:id`) |
| canal `asset-updates` | `activos-actualizaciones` |
| `SET panic_mode true` | `SET modo_panico true` |
| `GET /assets/:id/history` | `GET /api/activos/:id/historial` (ya existe) |
| `GET /health` | `GET /salud` (ya existe; se amplía) |
| `createAsset / updateAsset / deleteAsset` | `crearActivo / actualizarActivo / eliminarActivo` |
| `ecosystem.config.js` | `ecosystem.config.cjs` si PM2 no carga ESM (el proyecto es `"type": "module"`) |

### Claves de Redis

| Clave | Tipo | Para qué | Desde |
|---|---|---|---|
| `activo:<id>` | String JSON + TTL | Caché / modelo de lectura | S9 |
| `activos:todos` | String JSON + TTL | Lista para la consulta | S13 |
| `activos:mas-consultados` | Sorted Set (`ZINCRBY`) | Ranking | S9 |
| `preferencias:billetera` → `preferencias:<sub>` | Hash | Preferencias | S9 → S12 |
| `estadisticas:reportes-exitosos` | `INCR` | Bonus Parte 5 | S10 |
| `estadisticas:eventos-activos` | Hash (`HINCRBY`) | Contadores por tipo de evento | S14 |
| `modo_panico` | String | Bonus Parte 6 | S12 |
| `bull:cola-reportes:*` | (BullMQ) | Jobs | S10 |

## Convenciones que se mantienen

Las de `CLAUDE.md`: español, imports `.ts`, `import type`, sin `enum`; capas
`rutas → controladores → servicios → datos`; `config/env.ts` único lector de `process.env`
(Redis con una función `redisUrl()` como `mongoUri()`, para que `migrar` no la exija);
`ErrorApi` + `manejadorErrores`; dependencias por parámetro para testear sin red ni Redis
(fakes en memoria); el contrato existente no se rompe salvo lo que exige la Parte 6 (token).
GitFlow: `feature/sesion-N-<tema>` → `develop` (`--no-ff`, push) → `main` al cerrar cada parte
con OK del estudiante. **Commits sin `Co-Authored-By`.**

## Sesiones

Cada sesión deja la app funcionando, con `check`, tests y Newman en verde, y cierra con su
entrada en `BITACORA.md`. Al empezar me decís modelo y esfuerzo.

### Sesión 9 — Redis: infraestructura, caché, preferencias y ranking
- Preparación: `PLAN.md` nuevo (este), archivar el anterior, entrada de la sesión 8 en la
  bitácora, `CLAUDE.md` con comandos nuevos. Prender Docker Desktop (estaba apagado).
- Compose: servicio `redis` (`redis:7.4-alpine` como el ejemplo), AOF, contraseña desde `.env`
  sin dejarla literal en `docker inspect`, healthcheck autenticado, `127.0.0.1`, volumen,
  `maxmemory-policy noeviction` (BullMQ lo exige: no puede perder jobs por desalojo).
- `.env`/`.env.example`: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `CACHE_TTL_SEGUNDOS`.
- `src/datos/redis.ts`: cliente `redis` (oficial) con nombre, `on('error')`, `on('reconnecting')`,
  `disableOfflineQueue` (si Redis cae, los comandos fallan enseguida en vez de quedar colgados).
  `servidor.ts` hace `connect()` al arrancar (fail fast, como las otras bases) y `cerrarConexiones`
  suma el `quit()`. `db:verificar` hace `PING`.
- `src/servicios/cacheActivos.ts` (fábrica con el cliente inyectado): `GET /api/activos/:id` con
  cache-aside (`get` → si falla, MySQL → `set` con `EX`). PUT/DELETE invalidan después de que
  MySQL confirma. **Mejor esfuerzo**: Redis caído → se loguea y se sirve desde MySQL. Header
  `X-Cache: HIT|MISS` para verlo en Postman y en k6.
- Ranking: `ZINCRBY activos:mas-consultados` en cada consulta por id.
- `GET` / `PUT /api/preferencias` (Hash, Zod: `monedaVisualizacion`, `limiteAlertaUsd`).
  Son la fuente de verdad: con Redis caído → 503.
- Tests con un Redis falso: hit, miss, Redis caído, invalidación, preferencias.

### Sesión 10 — BullMQ: cola de reportes, worker y cierre de la Parte 5
- `bullmq` + `ioredis` (en BullMQ 6 `ioredis` es una dependencia opcional, no viene incluida; se probó el adaptador del
  cliente oficial y no resistió una caída de Redis). Conviven dos clientes: el oficial para lo que pide la letra y
  `ioredis` dentro de BullMQ.
- `src/colas/colaReportes.ts`: `cola-reportes`, 3 intentos con backoff, limpieza de jobs viejos.
- `POST /api/activos/reporte` → 202 + `Location` + `{ idReporte, estado: "en_cola" }`;
  `GET /api/reportes/:id` → estado (`en_cola | procesando | completado | fallido`), progreso,
  resultado o motivo. Redis caído → 503.
- `src/reportes/generarReporte.ts` (dependencias inyectadas): "Reporte de Valoración Masiva":
  todos los activos, precios de CoinGecko en **una** llamada (nueva `obtenerPrecios(simbolos)`
  que reutiliza `extraerPrecio` de `preciosServicio.ts`), totales y P/L, demora simulada
  (`REPORTE_DEMORA_MS`) con progreso. Un símbolo sin precio va a `sinPrecio`; si falla todo,
  el job falla y BullMQ reintenta.
- `src/procesos/workerReportes.ts`: proceso aparte; conecta MySQL, Mongo y Redis; registra el
  resultado en la auditoría (`GENERAR_REPORTE`, entidad `Reporte`: se amplían el enum del schema
  y los tipos de `modelos/auditoria.ts`). Acá el fallo de Mongo **sí** hace fallar el job: la
  cola reintenta, a diferencia de la auditoría de mejor esfuerzo del CRUD.
- `worker.on('completed')` / `on('failed')` → Winston; en `completed`, `INCR` del contador
  (bonus). `GET /api/estadisticas`: reportes exitosos + top 5 más consultados.
- Cierre ordenado del worker: `worker.close()` espera el job en curso.
- Compose: servicio `worker-reportes` (misma imagen, `command` propio). Script `npm run worker`.
- Tests: valoración, `sinPrecio`, todo falla → lanza, estados del job, estadísticas.
- **Cierre de la parte:** Postman (preferencias, reporte con polling, estadísticas, caché),
  README (Redis, caché, cola, tabla de nombres), `RESPUESTAS-PARTE-5.md`, `/code-review` (high),
  merge a `main` con tu OK y mensaje al profesor.

### Sesión 11 — Auth0 y middleware JWT
- Te guío en Auth0 (cuenta gratuita, ~15 min): API con identificador (audience), RS256; los
  tres roles; Action post-login que agrega `https://portafolio-cripto/roles`; tres usuarios de
  prueba (uno por rol); aplicación con grant *Password* para obtener tokens desde Postman y k6.
- `jose`. Variables: `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_CLAIM_ROLES`. El
  middleware no sabe que es Auth0: cambiar de IdP es cambiar configuración.
- `src/seguridad/verificadorJwt.ts` (fábrica): `jwtVerify` con issuer, audience y `RS256`;
  devuelve `{ sub, roles }` (roles desconocidos se descartan). En la app usa
  `createRemoteJWKSet` (cachea las claves); en los tests, claves generadas en el momento con
  `createLocalJWKSet` + `SignJWT` → **sin red**.
- `src/middlewares/autenticacion.ts`: `Authorization: Bearer` → `res.locals.usuario`; sin token,
  mal formado, vencido, firma, issuer o audience incorrectos → 401 con `WWW-Authenticate`.
  Auth0 inalcanzable para bajar las JWKS → 503 (no es culpa del cliente).
- Todo `/api` exige token; `/salud` queda pública. `GET /api/yo` devuelve `sub` y roles.
- Postman: carpeta "00 - Tokens" que pide los tres tokens a Auth0; entorno local con secretos
  en `.gitignore` y un `.ejemplo` versionado.
- Tests del verificador (vencido, firma ajena, `alg: none`, audience/issuer errados, sin roles)
  y del middleware.

### Sesión 12 — RBAC, modo pánico y cierre de la Parte 6
- `src/seguridad/roles.ts` + `autorizar(...roles)` → 403. Permisos:

  | Endpoint | AUDITOR | TRADER | ADMIN |
  |---|:-:|:-:|:-:|
  | `GET` activos, precio, historial de un activo, `/precios/:simbolo` | ✓ | ✓ | ✓ |
  | `GET /api/auditoria` | ✓ | – | ✓ |
  | `POST/PUT/DELETE /api/activos`, `POST /api/activos/analizar` | – | ✓ | ✓ |
  | `GET /api/preferencias` / `PUT` | ✓ / – | ✓ | ✓ |
  | `POST /api/activos/reporte`, `GET /api/reportes/:id`, `GET /api/estadisticas` | – | – | ✓ |
  | `DELETE /api/admin/cache`, `GET/PUT /api/admin/modo-panico` | – | – | ✓ |

- Limpiar caché: `SCAN` + `DEL` solo de `activo:*` y `activos:*`. **Nunca `FLUSHALL`**: borraría
  jobs, preferencias y contadores.
- Modo pánico: middleware en las rutas de escritura (CRUD y `PUT /preferencias`); si
  `modo_panico` está activo y el usuario no es ADMIN → 403. Si no se puede leer Redis → 503
  (falla cerrado: ante la duda, no se escribe). Al estar en Redis lo ven todas las instancias.
- Preferencias por usuario (`preferencias:<sub>`); el reporte y la auditoría guardan quién lo
  pidió (`metadatos.usuario`).
- Postman: casos 401, 403 por rol y el ciclo del modo pánico.
- **Cierre:** README (seguridad, roles, Auth0 paso a paso), `RESPUESTAS-PARTE-6.md`,
  `/code-review` + `/security-review`, merge a `main`, mensaje al profesor.

### Sesión 13 — CQRS: comandos, consultas y publicación de eventos
- `activosServicio.ts` se separa en `servicios/comandos/activosComandos.ts` (crear, actualizar,
  eliminar: pipeline + MySQL + publicar) y `servicios/consultas/activosConsultas.ts` (listar,
  obtener, precio, historial: Redis primero, MySQL si no está y se guarda en Redis).
- `src/eventos/eventoActivo.ts`: contrato Zod versionado (`idEvento`, `tipo`
  `ACTIVO_CREADO | ACTIVO_ACTUALIZADO | ACTIVO_ELIMINADO`, `activoId`, `antes`, `despues`,
  `camposModificados`, `metadatos` con usuario y conversión, `ocurridoEn`).
- `src/eventos/publicador.ts`: `PUBLISH activos-actualizaciones` después de que MySQL confirma;
  si Redis falla, se loguea y la operación responde bien (mismo criterio que la auditoría).
- En esta sesión los comandos **siguen** actualizando caché y auditoría directamente (nadie
  escucha todavía); se ve el canal con `redis-cli SUBSCRIBE`. La app queda andando.
- Tests: comandos con repo y publicador falsos; consultas (hit, miss, Redis caído); contrato.

### Sesión 14 — Pub/Sub: suscriptores y cierre de la Parte 7
- `src/procesos/suscriptorProyecciones.ts`: dos conexiones (`subscribe` + `duplicate()` para
  datos) y Mongo. Por evento: (1) `SET`/`DEL activo:<id>` y `DEL activos:todos`;
  (2) `ZREM` del ranking al eliminar y `HINCRBY estadisticas:eventos-activos`; (3) auditoría en
  Mongo, idempotente por `idEvento` (índice único).
- Los comandos dejan de tocar caché y auditoría: solo MySQL + publicar (lo que pide la letra).
- `src/procesos/suscriptorNotificaciones.ts` (bonus): si el monto supera el `limiteAlertaUsd`
  de las preferencias del usuario (o `UMBRAL_MONTO_USD`), log "Notificación enviada al usuario".
  Reutiliza la regla de Whale Alert de `filtroAnalisisRiesgo.ts` (se extrae a una función).
- Compose: dos servicios más, misma imagen. Scripts `npm run suscriptor:*`.
- Demostración del reto: con el suscriptor parado, el evento se pierde; con el worker parado, el
  job de BullMQ espera y se procesa al volver.
- README "CQRS y rendimiento" con evidencia: `Com_select` de MySQL antes/después de N lecturas
  cacheadas. Consistencia eventual documentada (ventana entre el 201 y el suscriptor; TTL como
  red de seguridad).
- **Cierre:** `RESPUESTAS-PARTE-7.md` (CQRS, Pub/Sub vs BullMQ, reto, Streams/Outbox como
  mejora), `/code-review`, merge a `main`, mensaje al profesor.

### Sesión 15 — PM2 cluster, salud, cierre ordenado y monitor de reinicios
- `pm2` como dependencia. `ecosystem.config.cjs`: `api` en cluster
  (`instances: PM2_INSTANCES ?? "max"`, `autorestart`, `max_memory_restart: "300M"`,
  `wait_ready`, `kill_timeout` > tiempo de cierre); worker y suscriptores en fork con **una**
  instancia (no se multiplican con la API); `monitor-reinicios`.
- Docker: cada contenedor corre `pm2-runtime ecosystem.config.cjs --only <app>` (el de la API
  junto con el monitor). `process.send('ready')` al escuchar.
- Migraciones: servicio de una sola ejecución en compose del que dependen los demás;
  `MIGRAR_AL_ARRANCAR` (true en `.env` para `npm run dev`, false en compose) para que 16
  instancias no migren a la vez.
- `GET /salud`: chequea MySQL, Mongo y Redis en paralelo con tiempo máximo → 200 `ok` o 503
  `degradado`, con el detalle por base, `pid` e instancia. Header `X-Instancia` en todas las
  respuestas (k6 cuenta el reparto).
- Cierre ordenado en todos los procesos: HTTP deja de aceptar, espera lo pendiente, cierra la
  cola, Redis, Sequelize y Mongoose; el worker espera el job activo.
- `src/procesos/monitorReinicios.ts`: escucha el bus de PM2 y, si una instancia reinicia más de
  5 veces en 60 s, `logger.error` marcado como crítico. La ventana deslizante es una función
  pura con tests. (Plan B si el bus no anda dentro de `pm2-runtime`: contador en Redis al arrancar.)
- Verificación: `pm2 ls`, `kill -9` de una instancia, 6 kills seguidos → log crítico,
  `pm2 reload api` con una petición lenta en curso, `docker compose stop worker-reportes` con un
  job a medias.

### Sesión 16 — Pruebas de carga y cierre de la Parte 8
- k6 en compose (perfil `carga`, imagen `grafana/k6`, como el laboratorio). `carga/prueba-carga.js`:
  `setup()` pide un token TRADER a Auth0 y crea activos semilla; escenarios en paralelo con 100
  usuarios: **lectura** (80, `GET /api/activos/:id` desde Redis) y **escritura** (20, `POST` +
  `DELETE` en USD: pipeline + MySQL + evento). Umbrales p95 < 500 ms, fallas < 1 %, 0 5xx;
  contadores por instancia y tasa de `X-Cache: HIT`.
- Corridas en la misma máquina: 1 instancia vs `max` (16) y, por la RAM, también 4. Tabla con
  req/s, p50, p95, p99 y errores por escenario.
- `pm2 monit` durante el estrés: lo abrís vos y sacás capturas (es interactivo); yo dejo
  `pm2 jlist` y `docker stats` como respaldo.
- **Cierre:** `RESPUESTAS-PARTE-8.md` con resultados e interpretación (dónde está el cuello de
  botella, por qué más procesos no siempre ayudan), README (PM2, salud, carga),
  `/code-review` + `/security-review` final, merge a `main`, mensaje final al profesor.

## Documentación del trabajo en conjunto

- **Entrada de la sesión 8** (ya escrita en `BITACORA.md`):
  2026-10-30 · Planificación · Opus 5.5 · esfuerzo extra alto · modo plan. Lectura de las 4 letras
  y los 2 ejemplos, del código y de la bitácora; consultas de solo lectura (versiones en npm,
  puertos, núcleos, Docker). Sin subagentes ni skills. Decisiones de la tabla de arriba.
  Hallazgos: el PDF de la Parte 7 dice "Parte 6"; la Parte 6 dice "etapa final" pero hay dos más;
  Bull en mantenimiento; Docker Desktop apagado; la máquina tiene 16 núcleos y 7,8 GB de RAM;
  `PLAN.md` decía que faltaba el merge de la Parte 4 pero ya está en `main`.
- Cada sesión: fecha · modelo y esfuerzo · modo · skills y herramientas · decisiones (quién y por
  qué) · verificación · pendientes. Toda skill va también a la tabla resumen de `BITACORA.md`.
- Al cerrar cada parte: mensaje al profesor en primera persona.

**Modelo sugerido** (lo que se use de verdad queda en la bitácora): Sonnet 5.5 · alto para las
sesiones 9, 10, 12, 13 y 16; Opus 5.5 · alto para la 11 (seguridad y configuración externa), la 14
(consistencia asíncrona) y la 15 (cluster, señales y Docker).

**Skills previstas:** `/code-review` (high) al cerrar cada parte; `/security-review` al cerrar la
Parte 6 (autenticación) y la 8 (sistema completo); `/simplify` si una sesión queda cargada.

## Riesgos conocidos

- **RAM (7,8 GB) con `instances: "max"` = 16 procesos** + 3 bases + Docker: puede no entrar. El
  ecosistema define `max` (lo pide la letra) pero `PM2_INSTANCES` permite medir con menos.
- **Conexiones**: 16 instancias × pool de Sequelize (5) = 80 conexiones a MySQL (límite 151). Se
  revisa antes de la prueba.
- **Tipos** de BullMQ, `redis` y `jose` con TypeScript 7: `npm run check` apenas se instalan.
- **Pub/Sub pierde mensajes** si el suscriptor está caído: auditoría y caché dependen de él desde
  la sesión 14. Se documenta y se demuestra; TTL como red de seguridad.
- **Auth0** en ejecución: si no responde, no se pueden bajar las JWKS (`jose` las cachea). Los
  tests no lo necesitan. El profesor necesita credenciales de prueba para probar a mano.
- **Postman/Newman** desde la Parte 6 necesitan tokens: entorno local fuera del repo.
- **PM2 y ESM**: si no carga `ecosystem.config.js` con `"type": "module"`, se usa `.cjs`.

## Verificación

Al cierre de cada sesión: `npm run check`, `npm test`, `docker compose up -d --build --wait` con
todo `healthy`, Newman dos veces seguidas.

- **Parte 5**: `GET` por id dos veces → `MISS` y `HIT` (`redis-cli TTL activo:<id>`); PUT →
  siguiente `MISS` con el dato nuevo; Redis caído → lecturas 200 desde MySQL, preferencias y
  reporte 503; reporte 202 → polling → `completado`, registro `GENERAR_REPORTE` en Mongo, log de
  `completed`, contador +1; CoinGecko roto → 3 intentos y `failed`; worker parado → el job espera
  y se procesa al volver.
- **Parte 6**: sin token / basura / vencido → 401; AUDITOR `POST` → 403; TRADER estadísticas →
  403; ADMIN todo; limpiar caché no toca jobs ni preferencias; ciclo del modo pánico.
- **Parte 7**: `SUBSCRIBE` muestra los eventos; la auditoría la escribe el suscriptor; PUT → el
  `GET` siguiente trae el dato nuevo desde Redis; suscriptor parado → evento perdido; Whale Alert
  en el log de notificaciones; `Com_select` casi no se mueve con lecturas cacheadas.
- **Parte 8**: `pm2 ls` con N instancias; `/salud` 200 → bajar Redis → 503; kill → reinicio;
  6 kills en 1 min → log crítico; reload con petición lenta → termina 200; tabla de k6.

## Mensaje de encare para el profesor (borrador)

> Hola profe, le cuento cómo voy a encarar las partes 5 a 8 del ejercicio de la API cripto.
>
> Igual que antes, trabajo con Claude Code. Empecé con una sesión solo de planificación (modelo
> Opus 5.5 con esfuerzo extra alto, en modo plan, que no modifica nada): le pasé las cuatro letras
> y los dos ejemplos nuevos (Pub/Sub con Redis y el laboratorio de PM2), revisó cómo quedó el
> proyecto después de la Parte 4 y armamos un plan de ocho sesiones, dos por parte. Cada parte la
> cierro con tests, revisión de código y prueba manual antes de empezar la siguiente.
>
> Lo principal que decidí:
> - **Parte 5:** Redis con el cliente oficial para la caché de activos (con TTL), las
>   preferencias (Hash) y contadores atómicos. Para la cola de reportes uso BullMQ en lugar de
>   Bull, porque Bull está en modo mantenimiento y sus mismos autores recomiendan BullMQ; los
>   conceptos de la letra (cola, worker, eventos completed/failed) son los mismos. El worker corre
>   como un proceso aparte.
> - **Parte 6:** Auth0 como proveedor de identidad. La API valida la firma de los JWT con las
>   JWKS de Auth0 y los roles AUDITOR, TRADER y ADMIN vienen en el token. Los tests generan sus
>   propias claves, así que no dependen de internet. El Panic Mode vive en Redis para que lo vean
>   todas las instancias.
> - **Parte 7:** separo comandos y consultas; las consultas leen primero de Redis. Después de
>   cada escritura en MySQL la API publica un evento, y dos procesos suscriptores actualizan la
>   caché, los contadores y la auditoría, o avisan de las Whale Alerts. Voy a mostrar en la
>   práctica que Pub/Sub pierde el mensaje si el suscriptor está caído, y que la cola de BullMQ no.
> - **Parte 8:** PM2 en modo cluster solo para la API; el worker y los suscriptores van con una
>   instancia cada uno para no duplicar trabajo, y las migraciones pasan a ser un paso aparte para
>   que las instancias no las corran a la vez. Pruebas de carga con k6, una instancia contra el
>   cluster.
>
> Mantengo los nombres en español, como en el resto del proyecto, con una tabla en el README que
> los relaciona con los de la letra. Sigo llevando la bitácora en el repo (modelo y esfuerzo de
> cada sesión, qué decidimos y quién, y qué se verificó). Al cerrar cada parte le mando el resumen.
