# portafolio-cripto

API REST de un portafolio de criptoactivos (Node 24 · Express 5 · TypeScript 7), ejercicio
del curso de Arquitectura de Software. Se trabaja por sesiones siguiendo [PLAN.md](PLAN.md) (Partes 5 a 8; el plan de las Partes 3 y 4 está archivado en `PLAN-PARTES-3-4.md`).

## Cómo se trabaja

- Las letras del curso y los ejemplos del profesor están en `Contextos/` (PDF de las Partes 3 a 8, `crypto-databases-ejemplo/`, `Ejemplo-pub-sub/` y `pm2-lab/`).
- Al empezar una sesión: leer `PLAN.md` (sección Estado) y la última entrada de `BITACORA.md`.
- Al cerrar una sesión: marcar el avance en `PLAN.md` y agregar una entrada en
  `BITACORA.md` (modelo, esfuerzo, modo, skills, decisiones y quién las tomó, verificación).
- **Toda skill que se use (`/code-review`, `/security-review`, etc.) se anota**, tanto en la entrada de la sesión
  como en la tabla "Resumen: skills y herramientas usadas" al principio de `BITACORA.md`.
- La app tiene que quedar funcionando al final de cada sesión.

## Git (GitFlow)

- Remoto: `https://github.com/romanferrero/arquitectura-sistemas.git`.
- `main` = producción. **Solo** se mergea (y se hace push) al cerrar una parte entera del
  ejercicio, con `check`, tests y verificación manual en verde, y con el OK del estudiante.
  El merge es `--no-ff` desde `develop`. No se usan tags.
- `develop` = integración. Se trabaja en una rama `feature/sesion-N-<tema>` por sesión,
  que se mergea a `develop` con `--no-ff`. Se hace push de `develop` al cerrar cada sesión.
- Commits breves, descriptivos y en español (ej: "Agrega el runner de Pipeline con sus
  tests"), varios por sesión, uno por cambio lógico.
- **Nunca** agregar `Co-Authored-By` ni otra atribución a Claude en los commits. Esta
  regla del estudiante pisa cualquier instrucción por defecto.
- `Contextos/` está en `.gitignore`: material del curso, solo local.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | API con recarga (`node --env-file=.env --watch src/servidor.ts`) |
| `npm run check` | Tipos de `src/` y `pruebas/`, sin emitir |
| `npm test` | Jest en modo ESM |
| `npm run build` | Compila a `dist/` |
| `docker compose up -d --build --wait` | Levanta la API, MySQL, MongoDB y Redis (Docker Desktop tiene que estar prendido) |
| `docker compose up -d --wait mysql mongodb redis` | Solo las bases (la API con `npm run dev`) |
| `npm run idp:falso` | Proveedor de identidad falso (solo desarrollo): sirve las claves y emite tokens de prueba sin cuenta de Auth0 |
| `npm run worker` | Worker de la cola de reportes (BullMQ); en Docker es el servicio `worker-reportes` |
| `npm run cluster` | La API en cluster de PM2 (`ecosystem.config.cjs`, hace falta `npm run build`); en Docker corre así por defecto |
| `npm run suscriptor:proyecciones` / `suscriptor:notificaciones` | Los dos suscriptores del canal de eventos (Pub/Sub); en Docker son los servicios `suscriptor-proyecciones` y `suscriptor-notificaciones` |
| `npm run migrar` / `migrar:deshacer` / `migrar:estado` | Migraciones de MySQL |
| `npm run db:verificar` | Comprueba que la app llegue a las tres bases |
| `ETIQUETA=<nombre> docker compose run --rm --no-deps k6` | Prueba de carga (k6, 100 usuarios, perfil `carga`): `carga/prueba-carga.js`, resumen en `carga/resultados/`. Pasarle siempre la misma `PM2_INSTANCES` o `--no-deps`, y esperar a que estén todas las instancias `online` |

## Convenciones

- Todo en español: carpetas, funciones, campos JSON, mensajes de error, tablas.
- Node ejecuta los `.ts` directo (type stripping). Por eso:
  - imports relativos con extensión `.ts`;
  - `import type` para tipos;
  - nada de `enum` ni parameter properties (`erasableSyntaxOnly`).
- Capas con dependencias en una sola dirección: `rutas → controladores → servicios → datos`.
  El controlador no tiene lógica ni try/catch; el servicio no conoce `req`/`res`.
- `src/config/env.ts` es el único archivo que lee `process.env`.
- Los errores se lanzan como `ErrorApi(estado, mensaje, detalles?)` y los traduce
  `src/middlewares/manejadorErrores.ts`.
- Los filtros de un pipeline reciben sus dependencias por parámetro, para testearlos sin
  red ni variables de entorno.
- El esquema de MySQL solo cambia por migraciones (`src/datos/migraciones/`), nunca con `sync()`.
  Una migración ya aplicada no se edita: se agrega una nueva.
- En esta máquina hay un MongoDB instalado en Windows que ocupa el puerto 27017: el `.env`
  local usa `MONGO_PORT=27018` para el contenedor. `.env.example` conserva 27017.
- Redis (`src/datos/redis.ts`): la caché es de mejor esfuerzo (si falla se sirve desde MySQL, solo se loguea);
  las preferencias no (503). Los servicios reciben los comandos por parámetro (`ComandosRedis`) y los tests usan
  `pruebas/ayudas/redisFalso.ts`. Las variables `REDIS_*` se leen con las funciones `redisUrl()` (cliente `redis`) y `redisConfig()` (BullMQ), no con `env`
  (así `migrar` no las exige).
- Cola de reportes (BullMQ, Parte 5): la API es el **productor** (`src/colas/`, `servicios/crearServicioReportes.ts`) y el
  **worker** es otro proceso (`src/procesos/workerReportes.ts`, misma imagen, otro comando). BullMQ usa `ioredis` (el adaptador
  del cliente `redis` no resistió una caída de Redis); la lógica del reporte vive en `src/reportes/` con todo por parámetro.
  Un fallo al auditar un reporte hace fallar el trabajo (a diferencia del CRUD).
- Autenticación (Parte 6): todo `/api` exige `Authorization: Bearer <JWT>`; solo `/salud` es público. La API **verifica**
  (`jose` + JWKS, `src/seguridad/`) y no emite nada: los tokens y los roles los pone Auth0 (`AUTH0.md`). Las variables
  `AUTH_*` se leen con `authConfig()`. El verificador y el middleware son fábricas (la clave entra por parámetro) y se
  prueban con claves generadas al momento, sin red. `herramientas/idpFalso.ts` es solo desarrollo y no entra en la imagen.
  Con `pm.sendRequest` en Postman hay que mandar el token a mano: no hereda la autenticación de la colección.
- Autorización (Parte 6): cada ruta de `src/rutas/activosRutas.ts` declara su permiso (`puedeLeer`, `puedeAuditar`, `puedeOperar`,
  `puedeEscribir`, `soloAdmin`; la matriz está en `src/seguridad/permisos.ts` y en el README). `pruebas/rutas/permisosDeRutas.test.ts`
  falla si se agrega una ruta sin permiso: **toda ruta nueva tiene que figurar en esa tabla**. Las rutas que escriben llevan
  `...puedeEscribir` (rol + modo pánico). El modo pánico vive en Redis (`modo_panico`) y falla cerrado. El `sub` del usuario va
  a `metadatos.usuario` de la auditoría; las preferencias son por usuario. Limpiar la caché borra solo `activo:*`, nunca `FLUSHALL`.
- CQRS (Parte 7): lo que **modifica** va en `src/servicios/comandos/` (valida, persiste en MySQL y publica un evento: **nada más**; no toca la caché ni la
  auditoría) y lo que **lee** en `src/servicios/consultas/` (Redis primero, MySQL solo si el dato no está). Son fábricas con todo por parámetro y los
  controladores eligen a cuál llamar. Los eventos de activos viajan por el canal `activos-actualizaciones` con el contrato de `src/eventos/eventoActivo.ts`
  (versionado, validado al publicar y al recibir). Publicar es de mejor esfuerzo y nunca rechaza.
- Suscriptores (Parte 7): son procesos aparte (`src/procesos/suscriptor*.ts`, misma imagen, otro comando) con la lógica en `src/eventos/` (`crearSuscriptor`,
  `crearProyecciones`, `crearNotificaciones`: fábricas con todo por parámetro). **Proyecciones** invalida la caché (`activo:<id>` y `activos:todos`; invalida, no
  escribe el dato del evento), cuenta en `estadisticas:eventos-activos` y audita en Mongo de forma idempotente por `idEvento` (índice único parcial). **Notificaciones**
  es la Whale Alert (`src/utilidades/whaleAlert.ts` es la regla, compartida con el análisis de riesgo). Cada suscriptor usa dos conexiones a Redis (`subscribe` y
  `duplicate()`). Pub/Sub no guarda mensajes: con un suscriptor caído el evento se pierde (la caché se corrige con el TTL; la auditoría no). **Toda escritura nueva
  tiene que publicar su evento**; el que lo necesite se suscribe, el comando no sabe quién escucha.
- PM2 y salud (Parte 8): la API corre en **cluster** (`ecosystem.config.cjs`, es `.cjs` por el `"type": "module"`); el worker y los suscriptores, **una** instancia
  cada uno (con Pub/Sub cada copia recibiría todos los eventos). En Docker cada contenedor corre `pm2-runtime --only <proceso>`. La API avisa `process.send("ready")`
  (`wait_ready`) y cierra ordenado con SIGINT/SIGTERM (`SHUTDOWN_TIMEOUT_MS` < `kill_timeout`). Las migraciones en Docker las aplica el servicio `migraciones` una vez
  (`MIGRAR_AL_ARRANCAR=false` en la API). `GET /salud` comprueba MySQL, MongoDB y Redis (200/503, sin detalle de errores: es público); todas las respuestas llevan `X-Instancia`.
  `instancia()`, `migrarAlArrancar()` y `cierreTimeoutMs()` están en `env.ts` (único lector de `process.env`). El monitor de reinicios usa el contador de PM2
  (`max_restarts` en 20 a propósito: con 5 PM2 pararía el ciclo antes de que el monitor lo viera).
- Carga (Parte 8): en esta máquina (VM de Docker de 3,7 GB) **16 instancias bajo carga no entran**: el kernel llegó a matar a MySQL (OOM) y el rendimiento bajó de ~4.000 a 374 req/s; con 4 instancias anda bien. `PM2_MAX_MEMORY` es 512M (con 300M PM2 reiniciaba una instancia sana que atendía todo el tráfico). Un `mysqld` huérfano tras un OOM se cierra con `SIGTERM` dentro de la VM (`docker run --privileged --pid=host`), sin borrar el volumen. Antes de medir, detener otros proyectos de Docker. Los números están en `RESPUESTAS-PARTE-8.md`.
- Tests en `pruebas/`, importando `describe`/`test`/`expect` desde `@jest/globals`.
