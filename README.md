# API REST — Portafolio de Criptoactivos

API REST para gestionar un portafolio de criptoactivos, con CRUD completo sobre
persistencia en MySQL, caché y preferencias en Redis, reportes asíncronos con una cola (BullMQ), autenticación con JWT (Auth0), control de acceso por roles y CQRS con eventos en Redis Pub/Sub, integración con APIs externas (cotizaciones y tipo de cambio)
y procesamiento con el patrón **Pipes & Filters**: un pipeline de ingesta para los activos
nuevos y otro de análisis de riesgo para lotes.

**Stack:** Node.js · Express 5 · TypeScript · Zod · Winston · Jest · MySQL · MongoDB · Redis · Docker

---

## Requisitos

- Node.js **22 o superior** (probado en v24.11). Se necesita esa versión para el flag
  nativo `--env-file` y para ejecutar archivos `.ts` sin compilar.
- Docker con Compose v2 (`docker compose`), para levantar MySQL, MongoDB y Redis.

---

## Instalación

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
```

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta la API en modo desarrollo con recarga automática |
| `npm run build` | Compila TypeScript a JavaScript en `dist/` |
| `npm start` | Ejecuta la versión compilada |
| `npm run check` | Verifica los tipos de `src/` y `pruebas/` sin generar archivos |
| `npm test` | Corre los tests con Jest |
| `npm run migrar` | Aplica las migraciones pendientes de MySQL |
| `npm run migrar:deshacer` | Deshace la última migración aplicada |
| `npm run migrar:estado` | Lista las migraciones aplicadas y las pendientes |
| `npm run idp:falso` | Proveedor de identidad falso para desarrollo y pruebas (imita a Auth0, sin cuenta) |
| `npm run worker` | Levanta el worker de la cola de reportes (en otra terminal, además de `npm run dev`) |
| `npm run suscriptor:proyecciones` | Levanta el suscriptor que deja la caché al día y registra la auditoría al recibir cada evento de activos |
| `npm run suscriptor:notificaciones` | Levanta el suscriptor de las Whale Alert (avisa cuando una operación supera el límite del usuario) |
| `npm run db:verificar` | Comprueba que MySQL, MongoDB y Redis respondan con la configuración del `.env` |

Los comandos son, en realidad:

```bash
node --env-file=.env --watch src/servidor.ts    # dev
tsc                                             # build
node --env-file=.env dist/servidor.js           # start
node --env-file=.env src/procesos/workerReportes.ts   # worker
node --env-file=.env src/procesos/suscriptorProyecciones.ts      # suscriptor de proyecciones
node --env-file=.env src/procesos/suscriptorNotificaciones.ts    # suscriptor de notificaciones
node --experimental-vm-modules node_modules/jest/bin/jest.js   # test
```

La API queda disponible en `http://localhost:3000`.

---

## Bases de datos

El proyecto usa tres motores, cada uno para lo que mejor hace: **MySQL** (vía Sequelize) para
la entidad `Activo`, que tiene estructura fija y reglas de integridad, y **MongoDB** (vía
Mongoose) para la auditoría, que crece rápido y no necesita un esquema rígido, y **Redis**
(cliente oficial `redis`) para la caché y las preferencias, que son datos chicos, de acceso
frecuente y que tienen que responder al instante.

```bash
docker compose up -d --wait mysql mongodb redis   # solo las bases: MySQL 8.4, MongoDB 8.0 y Redis 7.4, esperando a que estén healthy
npm run dev                                  # la API: conecta, migra y escucha (o npm run migrar a mano)
npm run db:verificar                         # comprueba que la app llega a las tres bases

# ...o todo, API incluida, dentro de Docker (ver la sección Docker):
docker compose up -d --build --wait
```

| Comando de Docker | Qué hace |
|---|---|
| `docker compose ps` | Estado de los contenedores |
| `docker compose stop` / `start` | Detiene / reanuda, conservando los datos |
| `docker compose down` | Elimina los contenedores, **conserva** los datos (están en volúmenes) |
| `docker compose down -v` | Elimina también los volúmenes: **borra todos los datos** |

Las credenciales y los puertos salen del `.env` (ver [`.env.example`](.env.example)), que lee
tanto Compose como la aplicación. Son credenciales de **desarrollo local**; los puertos se
publican solo en `127.0.0.1`.

> **Puerto ocupado:** si en tu máquina ya hay un MySQL o un MongoDB local en `3306` o
> `27017`, cambiá `MYSQL_PORT` o `MONGO_PORT` en el `.env` (por ejemplo `27018`) y volvé a
> levantar. Solo cambia el puerto del host; el del contenedor sigue siendo el mismo.

### Migraciones

El esquema de MySQL **solo cambia por migraciones** versionadas (con [Umzug](https://github.com/sequelize/umzug)),
nunca con `sync()`. Cada una tiene `up` (aplica) y `down` (deshace), y la lista vive en
[`src/datos/migraciones/index.ts`](src/datos/migraciones/index.ts). Umzug anota las ya
aplicadas en la tabla `migraciones`, así `npm run migrar` solo corre las que faltan y se
puede ejecutar las veces que haga falta.

### Tabla `activos`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | `CHAR(36)` | Clave primaria (el UUID que genera el servidor) |
| `simbolo` | `VARCHAR(10)` | No nulo, **único** |
| `nombre` | `VARCHAR(50)` | No nulo |
| `cantidad` | `DECIMAL(24,8)` | No nulo, **mayor a 0** (`CHECK`) |
| `precio_compra` | `DECIMAL(20,2)` | No nulo, **mayor a 0** (`CHECK`) |
| `creado_en`, `actualizado_en` | `DATETIME(3)` | No nulos |

Las reglas están también en la base y no solo en el código: aunque otra aplicación escriba
directo en la tabla, MySQL rechaza un símbolo repetido o una cantidad que no sea positiva.
Se usa `DECIMAL` y no `FLOAT` para no arrastrar errores de redondeo con dinero.

### Auditoría en MongoDB

Cada vez que se **crea, actualiza o elimina** un activo en MySQL hay un registro en la colección
`auditoria_activos` de MongoDB. Lo escribe el **suscriptor de proyecciones** al recibir el evento que publicó
el comando (ver *CQRS*): la API no escribe en MongoDB. Los registros no tienen forma fija, y por eso viven
en MongoDB y no en una tabla:

| Operación | `antes` | `despues` | Otros campos |
|---|---|---|---|
| `CREAR` | — | el activo creado | `metadatos.conversionMoneda` si se convirtió de moneda |
| `ACTUALIZAR` | el activo anterior | el activo guardado | `camposModificados` |
| `ELIMINAR` | el activo tal como era | — | — |

```json
GET /api/activos/5406e802-8334-4742-9529-38db013da828/historial

[
  { "operacion": "ELIMINAR", "entidadId": "5406e802-...", "antes": { "simbolo": "BTC", "cantidad": 1.25, "precioCompra": 42000 },
    "metadatos": { "origen": "API" }, "ocurridoEn": "2026-10-07T20:55:10.113Z" },
  { "operacion": "ACTUALIZAR", "antes": { "cantidad": 0.5 }, "despues": { "cantidad": 1.25 },
    "camposModificados": ["cantidad", "precioCompra"], "ocurridoEn": "2026-10-07T20:55:10.060Z" },
  { "operacion": "CREAR", "despues": { "simbolo": "BTC", "cantidad": 0.5, "precioCompra": 112.52 },
    "metadatos": { "origen": "API", "conversionMoneda": { "monedaOriginal": "EUR", "precioOriginal": 100, "tasa": 1.12519 } },
    "ocurridoEn": "2026-10-07T20:55:09.870Z" }
]
```

Va del evento más reciente al más viejo y sigue disponible aunque el activo ya no exista (es
justamente lo que queda). `GET /api/auditoria` lista el historial general; `?operacion=ELIMINAR`
filtra y `?limite=` acota (de 1 a 200, 50 por defecto). Un id que nunca existió da 404.

> **La auditoría es asíncrona y de mejor esfuerzo.** MySQL y MongoDB son dos escrituras independientes y no hay
> una transacción que abarque las dos. MySQL confirma primero; el registro aparece un instante después, cuando el
> suscriptor procesa el evento. Si MongoDB falla, el suscriptor deja el error en su log y sigue; si el suscriptor
> está **detenido**, los eventos de ese lapso **no se auditan** (Pub/Sub no los guarda). Es el costo de desacoplar
> la API de MongoDB: puede haber operaciones sin registro. Cada registro de un evento lleva su `idEvento` (índice
> único), así que recibir el mismo evento dos veces no lo duplica. Las consultas del historial responden 503 si
> MongoDB no está. La solución completa sería un *Transactional Outbox* (ver mejoras).

### Redis: caché, ranking y preferencias

Redis (`redis:7.4-alpine`, con contraseña y persistencia AOF) cumple dos papeles distintos, y la
diferencia importa para entender qué pasa cuando se cae:

| Uso | Estructura | Si Redis falla |
|---|---|---|
| **Caché** de `GET /api/activos/:id` | String JSON con TTL (`SET ... EX`, `GET`) | Se **sigue sirviendo desde MySQL**: la caché es una optimización |
| **Ranking** de activos más consultados | Sorted Set (`ZINCRBY`, `ZREM`) | Se ignora y se loguea |
| **Preferencias** de cada usuario | Hash (`HSET`, `HGETALL`) | **503**: acá Redis es la única copia, no hay nada que devolver |

**Caché (cache-aside).** `GET /api/activos/:id` mira primero `activo:<id>`; si no está (`MISS`) lee
de MySQL y lo guarda con el TTL de `CACHE_TTL_SEGUNDOS`; la próxima lectura sale de Redis
(`HIT`). El header `X-Cache` lo informa. Cuando un `PUT` o un `DELETE` se confirma en MySQL, el **suscriptor de
proyecciones** invalida la clave al recibir el evento (ver *CQRS*). Solo la lectura por id y la lista usan la caché: actualizar, eliminar y calcular el
rendimiento leen siempre de MySQL, que es la fuente de verdad.

```bash
curl -i http://localhost:3000/api/activos/<id>      # X-Cache: MISS
curl -i http://localhost:3000/api/activos/<id>      # X-Cache: HIT
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ttl activo:<id>'
```

**Límite conocido.** Si el evento no llega al suscriptor de proyecciones (Redis caído cuando se publica, o el
suscriptor detenido), la caché **no se invalida**: puede devolver el activo viejo **hasta que venza el TTL**.
Se comprobó: con el suscriptor parado, un `POST` dejó la lista cacheada sin el activo nuevo (`X-Cache: HIT`) aunque
MySQL ya lo tenía. También puede pasar, sin que nada se caiga, si una lectura que ya leyó de MySQL guarda su
resultado justo después de la invalidación. Por eso el TTL se mantiene corto.

**Ranking.** Cada consulta por id suma uno en `activos:mas-consultados` y borrar un activo lo saca.

**Preferencias.** `PUT /api/preferencias` actualiza solo los campos enviados
(`monedaVisualizacion`: código de 3 letras, se guarda en mayúsculas; `limiteAlertaUsd`: número
mayor a 0) y `GET` los devuelve; lo que no se configuró vuelve con el valor por defecto
(`MONEDA` y `UMBRAL_MONTO_USD`). Cada usuario tiene las suyas (`preferencias:<sub del token>`): lo que guarda uno no lo ve ni lo cambia otro.

**Conexión.** [`src/datos/redis.ts`](src/datos/redis.ts) sigue el ciclo de vida de la documentación
oficial: `createClient()`, un oyente `on("error")` (sin él, un Redis caído tumbaría el proceso),
`connect()` al arrancar y `quit()` al cerrar. Al arrancar no se reintenta: si Redis no está, la API
no levanta (igual que con MySQL y MongoDB). Ya conectada, si se cae reintenta con espera creciente y
mientras tanto los comandos fallan en el acto (`disableOfflineQueue`), así una caída de Redis no
demora las respuestas.

| Clave | Tipo | Contenido |
|---|---|---|
| `activo:<id>` | String + TTL | El activo en JSON |
| `activos:todos` | String + TTL | La lista completa del portafolio en JSON (la que sirve `GET /api/activos`) |
| `activos:mas-consultados` | Sorted Set | Id del activo → cantidad de consultas |
| `activos-actualizaciones` | Canal Pub/Sub (no es una clave) | Los eventos de activos creados, actualizados y eliminados |
| `estadisticas:eventos-activos` | Hash (`HINCRBY`) | Cuántos eventos de cada tipo procesó el suscriptor de proyecciones |
| `preferencias:<sub>` | Hash | `monedaVisualizacion`, `limiteAlertaUsd` de ese usuario |
| `modo_panico` | String | `"true"` mientras el modo pánico está activo (ver *Roles y modo pánico*) |

### Reportes asíncronos: cola (BullMQ) y worker

Calcular un reporte de todo el portafolio es trabajo lento (consulta precios a un tercero y
cuenta mucho), y no tiene por qué hacer esperar al cliente. Por eso **la API no lo calcula**: deja
un pedido en una cola y responde enseguida; otro proceso, el **worker**, lo hace.

```
POST /api/activos/reporte ──► API (productor) ──► cola-reportes (Redis) ──► worker ──► MongoDB
        └─ 202 + id al instante                    └─ el pedido queda guardado          (auditoría)
GET /api/reportes/:id  ◄── estado y progreso, y el resultado cuando termina
```

```bash
docker compose up -d --build --wait          # incluye el servicio worker-reportes
# (o en local: npm run dev  y, en otra terminal, npm run worker)

curl -i -X POST http://localhost:3000/api/activos/reporte        # 202 + Location + { idReporte, estado: "en_cola" }
curl http://localhost:3000/api/reportes/<idReporte>              # en_cola -> procesando (progreso) -> completado
curl http://localhost:3000/api/estadisticas                      # reportes exitosos, eventos de activos por tipo y activos más consultados
docker compose logs -f worker-reportes                           # los eventos completed / failed
```

**Estados de un reporte:** `en_cola` (también mientras espera un reintento), `procesando` (con su
porcentaje), `completado` (trae el `resultado`) y `fallido` (trae el `motivo`). Un id que no existe, o
que no es un UUID, da 404; con Redis caído, 503.

**Qué contiene el reporte:** el portafolio valuado a precio de mercado, con una sola llamada a CoinGecko:
`resumen` (costo total, valor actual, ganancia/pérdida y variación %), una entrada por posición, y
`sinPrecio` con los símbolos que no se pudieron cotizar (no hacen fallar el reporte ni cuentan en los
totales). La demora del "cálculo complejo" es simulada (`REPORTE_DEMORA_MS`).

**Reintentos y eventos.** Cada trabajo se intenta hasta **3 veces** con espera creciente (1 s, 2 s). Los
eventos `completed` y `failed` del worker escriben en Winston en cada caso; en `completed` además se
incrementa el contador `estadisticas:reportes-exitosos` con **`INCR`** (atómico: lo comparten todos los
procesos y no se pierden incrementos aunque haya varios workers).

```
[INFO]  WorkerReportes: Generando el reporte d5295196-… (intento 1)
[INFO]  WorkerReportes: Reporte d5295196-… completado (reportes exitosos hasta ahora: 1)
[ERROR] WorkerReportes: Reporte e76557de-… falló (intento 1 de 3), se reintenta: No se pudo contactar a la API de precios
[ERROR] WorkerReportes: Reporte e76557de-… falló definitivamente tras 3 intento(s): No se pudo contactar a la API de precios
```

**Auditoría.** Al terminar, el worker registra en MongoDB una operación `GENERAR_REPORTE` sobre la entidad
`Reporte` (con el resumen, el intento y la duración). A diferencia de la auditoría del CRUD, acá un fallo al
registrar **hace fallar el trabajo** y la cola lo reintenta: un reporte se puede regenerar; una operación
ya confirmada en MySQL no se puede deshacer.

**El worker es otro proceso**, con la misma imagen y otro comando (`node dist/procesos/workerReportes.js`).
Se puede detener o reiniciar sin tocar la API (sumar más workers es posible, pero no se probó). Con `docker compose stop worker-reportes` (SIGTERM)
**termina el reporte en curso** antes de salir. Si el worker está caído, los pedidos esperan en la cola y
se procesan cuando vuelve.

**Dos clientes de Redis.** La caché, las preferencias y el contador usan el cliente oficial `redis`;
BullMQ abre sus propias conexiones con `ioredis`. BullMQ 6 también admite el cliente oficial, pero en las
pruebas una caída de Redis tumbaba el proceso y la recuperación no fue limpia; con `ioredis` sí.

| Clave | Tipo | Contenido |
|---|---|---|
| `estadisticas:reportes-exitosos` | String (`INCR`) | Reportes generados con éxito |
| `bull:cola-reportes:*` | (BullMQ) | Los trabajos, sus estados y resultados |

---

## Docker

### Todo el proyecto con un solo comando

```bash
cp .env.example .env
docker compose up -d --build --wait     # la API, MySQL, MongoDB y Redis
curl http://localhost:3000/salud
```

`docker-compose.yml` levanta siete servicios y espera a que estén sanos:

| Servicio | Imagen | Notas |
|---|---|---|
| `api` | La del [`Dockerfile`](Dockerfile) (Node 24, multi-stage, usuario sin privilegios) | Arranca recién cuando MySQL, MongoDB y Redis están `healthy`; aplica las migraciones al iniciar |
| `worker-reportes` | La misma imagen que `api`, con otro comando | Proceso aparte que consume la cola de reportes. Espera a que la API esté sana (ella aplica las migraciones). Sin puertos |
| `suscriptor-proyecciones` | La misma imagen que `api`, con otro comando | Suscriptor del canal `activos-actualizaciones`: deja la caché al día, cuenta el evento y registra la auditoría en MongoDB. Sin puertos; no necesita a la API ni a MySQL |
| `suscriptor-notificaciones` | La misma imagen que `api`, con otro comando | Otro suscriptor del mismo canal: avisa de las Whale Alert (solo usa Redis). Sin puertos |
| `mysql` | `mysql:8.4` | Datos en el volumen `mysql_data` |
| `mongodb` | `mongo:8.0` | Datos en el volumen `mongodb_data` |
| `redis` | `redis:7.4-alpine` | Con contraseña y AOF, datos en el volumen `redis_data`. La política `noeviction` hace que, con la memoria llena, rechace escrituras en vez de borrar claves en silencio (lo necesitará la cola de la Parte 5) |

Los cuatro puertos se publican solo en `127.0.0.1`. La API recibe el mismo `.env` que usás en
local, pero el compose **pisa** las variables que cambian dentro de la red de Docker: allí las
bases no están en `localhost` sino bajo el nombre de su servicio (`MYSQL_HOST=mysql`,
`MONGO_HOST=mongodb`, `REDIS_HOST=redis`; el bloque lo comparten la API, el worker y los suscriptores) y se llega por el puerto interno (`3306`, `27017`, `6379`), no por el que se
publica al host.

| Comando | Qué hace |
|---|---|
| `docker compose logs -f api` | Sigue los logs de la API |
| `docker compose logs -f worker-reportes` | Sigue los logs del worker (eventos `completed` y `failed`) |
| `docker compose logs -f suscriptor-proyecciones suscriptor-notificaciones` | Sigue a los dos suscriptores (eventos procesados y Whale Alert) |
| `docker compose up -d --wait mysql mongodb redis` | Solo las bases (y la API con `npm run dev`) |
| `docker compose down` | Baja todo y **conserva** los datos |
| `docker compose down -v` | Baja todo y **borra** los datos (incluida la caché): el próximo arranque parte de cero |

### La imagen sola

```bash
docker build -t portafolio-cripto .
docker run --rm -p 3000:3000 --env-file .env   -e MYSQL_HOST=host.docker.internal -e MONGO_HOST=host.docker.internal -e REDIS_HOST=host.docker.internal portafolio-cripto
```

Con el `.env` tal cual la API falla con `ECONNREFUSED`: dentro de un contenedor `localhost` es el
propio contenedor. Ese ejemplo apunta la imagen a las bases publicadas en el host.

> **Nota:** dentro del contenedor **no** se usa `--env-file` de Node. El archivo `.env`
> queda excluido de la imagen (ver `.dockerignore`) y las variables se inyectan al
> ejecutar. Así la imagen no lleva configuración adentro y sirve para cualquier entorno.

---

## Variables de entorno

Se cargan con el flag **nativo** de Node `--env-file`, sin usar la librería `dotenv`.

| Variable | Ejemplo | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de escucha |
| `NODE_ENV` | `development` | Entorno de ejecución |
| `API_PRECIOS_URL` | `https://api.coingecko.com/api/v3/simple/price` | Endpoint de CoinGecko |
| `API_TASAS_URL` | `https://open.er-api.com/v6/latest` | Endpoint de tipo de cambio (se consulta como `<URL>/<MONEDA>`) |
| `MONEDA` | `usd` | Moneda de las cotizaciones |
| `TIMEOUT_MS` | `5000` | Timeout de las llamadas externas |
| `MYSQL_HOST`, `MYSQL_PORT` | `localhost`, `3306` | Dónde está MySQL |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | `crypto_db`, `crypto_user`, … | Base y credenciales de la aplicación |
| `MYSQL_ROOT_PASSWORD` | — | Solo la usa Docker Compose al crear el contenedor |
| `MONGO_HOST`, `MONGO_PORT` | `localhost`, `27017` | Dónde está MongoDB |
| `MONGO_DATABASE` | `crypto_db` | Base donde se guarda la auditoría |
| `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD` | `mongo_root`, … | Usuario con el que se conecta la aplicación |
| `REDIS_HOST`, `REDIS_PORT` | `localhost`, `6379` | Dónde está Redis |
| `REDIS_PASSWORD` | — | Contraseña de Redis (la usa Docker Compose al crear el contenedor y la app al conectarse) |
| `AUTH_ISSUER` | `https://<tenant>.us.auth0.com/` | Quién emite los tokens (con la barra final) |
| `AUTH_AUDIENCE` | `https://portafolio-cripto/api` | Para quién son los tokens: el *identifier* de la API en Auth0 |
| `AUTH_JWKS_URL` | `https://<tenant>.us.auth0.com/.well-known/jwks.json` | Dónde están las claves públicas que verifican la firma |
| `AUTH_CLAIM_ROLES` | `https://portafolio-cripto/roles` | Claim del token que trae los roles |
| `REPORTE_DEMORA_MS` | `3000` | Demora simulada del worker al generar un reporte (admite 0) |
| `CACHE_TTL_SEGUNDOS` | `60` | Cuánto vive un activo en la caché antes de releerlo de MySQL |
| `UMBRAL_MONTO_USD` | `100000` | Monto (en USD) que, superado, dispara la *Whale Alert*. Admite 0 |
| `UMBRAL_VOLATILIDAD` | `80` | Volatilidad (en %) que, superada, marca un activo como `high_risk` |

Si falta alguna, la aplicación corta el arranque con un mensaje explícito
(*fail fast*, ver [`src/config/env.ts`](src/config/env.ts)).

---

## Autenticación (JWT)

**Todos los endpoints de `/api` exigen un token**; solo `/salud` es público (lo usan Docker y los monitores). La API
**no guarda usuarios ni contraseñas**: delega la autenticación en un proveedor de identidad (**Auth0**, opción B de la
letra de la Parte 6), que emite los JWT. La API solo los **verifica**. Cómo configurar Auth0: **[AUTH0.md](AUTH0.md)**.

```
Cliente ──(usuario y contraseña)──► Auth0 ──► JWT firmado
Cliente ──(Authorization: Bearer <JWT>)──► API ── verifica la firma con las claves públicas (JWKS) de Auth0 ──► rutas
```

```bash
curl -i http://localhost:3000/api/activos                                  # 401 + WWW-Authenticate: Bearer
curl -i http://localhost:3000/api/yo -H "Authorization: Bearer <token>"    # 200 {"sub":"auth0|...","roles":["TRADER"]}
```

**Qué comprueba el middleware** ([`verificadorJwt.ts`](src/seguridad/verificadorJwt.ts)), todo junto:

| Comprobación | Si falla |
|---|---|
| Header `Authorization: Bearer <token>` bien formado | 401 |
| **Firma**, con la clave pública que corresponde al `kid` del token (JWKS del proveedor) | 401 |
| **Algoritmo**: solo `RS256` (rechaza `alg: none` y la confusión de algoritmo con HS256) | 401 |
| `iss` (emisor), `aud` (para esta API), `exp` (vencimiento) y `nbf`, con 5 s de margen de reloj | 401 (`El token venció` si venció) |
| Que el token tenga `sub` (que identifique a alguien) | 401 |
| Poder bajar las claves del proveedor | **503** (no es culpa del cliente) |

El 401 lleva el header `WWW-Authenticate: Bearer`, y el mensaje de un token inválido **no dice qué falló** (no le sirve
a un atacante). `jose` baja las claves del proveedor una vez y las guarda en memoria: **no se consulta a Auth0 en cada
petición**. Verificado: con el proveedor caído, una API que ya tenía las claves sigue autenticando; una que nunca las
bajó responde 503.

**Roles.** Los roles (`AUDITOR`, `TRADER`, `ADMIN`) viajan **dentro del token**, en un claim propio
(`AUTH_CLAIM_ROLES`, con Auth0 `https://portafolio-cripto/roles`) que agrega una *Action* de Auth0. El middleware los
lee, descarta los que no conoce y los deja en la petición junto con el `sub` (`GET /api/yo` los muestra). Qué puede hacer
cada rol lo decide la **autorización**, en la sección siguiente.

**Variables:** `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL` y `AUTH_CLAIM_ROLES`. La app no sabe que es Auth0: para cambiar
de proveedor (Keycloak, Clerk, Supabase...) se cambian estas variables.

**Probar sin cuenta de Auth0.** `npm run idp:falso` levanta un proveedor de identidad falso en `localhost:4000` (publica
sus claves y emite tokens para los tres roles). Es una herramienta de desarrollo, fuera de `src/` y de la imagen de Docker.
Ver el final de [AUTH0.md](AUTH0.md).

---

## CQRS: comandos, consultas y eventos

**CQRS** (*Command Query Responsibility Segregation*) separa lo que **modifica** datos (comandos) de lo que solo los **consulta** (consultas), cada
lado con su propio servicio y su propio modelo de datos:

```
                 ┌── COMANDOS (crear, actualizar, eliminar) ──► MySQL ──► PUBLISH activos-actualizaciones
 Controlador ────┤        escritura: la fuente de verdad                    │  (el evento: "pasó esto")
                 │                                                          ├──► suscriptor de PROYECCIONES: invalida la caché, cuenta y audita (MongoDB)
                 │                                                          └──► suscriptor de NOTIFICACIONES: avisa de las Whale Alert
                 └── CONSULTAS (listar, ver, precio, historial) ──► Redis ──(si no está)──► MySQL
                          lectura: el modelo de lectura, sin pasar por la base principal
```

| | Comandos | Consultas |
|---|---|---|
| Qué hacen | Validan, persisten en MySQL y **anuncian** lo ocurrido | Leen. **Nunca** modifican |
| Dónde | [`servicios/comandos/`](src/servicios/comandos/crearComandosActivos.ts) | [`servicios/consultas/`](src/servicios/consultas/crearConsultasActivos.ts) |
| Fuente de datos | MySQL (el modelo de escritura) | **Redis** (el modelo de lectura); MySQL solo si el dato no está |
| Si Redis falla | La operación **se confirma igual** (el evento es de mejor esfuerzo) | Se lee de MySQL |

**El modelo de lectura.** `GET /api/activos` y `GET /api/activos/:id` (y el activo que usa `/precio`) salen de Redis (`activos:todos` y
`activo:<id>`). Si no están, se leen de MySQL y se guardan con TTL. El header `X-Cache` lo dice. El filtro `?simbolo=` se aplica sobre la lista
ya cacheada. Cuando un comando se confirma, el **suscriptor de proyecciones** invalida la entrada y la lista (el comando no toca la caché); el TTL corrige solo lo que se escape.

**El evento.** Después de que MySQL confirma, el comando publica un mensaje en el canal de Redis `activos-actualizaciones`
([contrato](src/eventos/eventoActivo.ts), validado con Zod en los dos extremos):

```json
{ "version": 1, "idEvento": "8f509a2c-…", "tipo": "ACTIVO_ACTUALIZADO", "activoId": "…",
  "antes": { "cantidad": 1, … }, "despues": { "cantidad": 2, … }, "camposModificados": ["cantidad"],
  "metadatos": { "origen": "API", "usuario": "auth0|…" }, "ocurridoEn": "2026-11-04T12:00:00.000Z" }
```

`ACTIVO_CREADO` trae `despues`, `ACTIVO_ELIMINADO` trae `antes` y `ACTIVO_ACTUALIZADO` trae los dos más los campos que cambiaron. Se puede ver en vivo:

```bash
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning subscribe activos-actualizaciones'
```

**Publicar es de mejor esfuerzo.** Si Redis no está en ese instante, el evento se pierde (queda en el log) y la operación responde bien igual:
MySQL ya confirmó y no hay forma de deshacerlo. Además **Pub/Sub no guarda el mensaje**: el log dice cuántos suscriptores lo recibieron
(`receptores: N`); con `0` el evento no le llegó a nadie ni se va a reenviar, y la API lo deja como **WARN**: nadie va a invalidar la caché ni auditar esa operación. La solución completa sería un *Transactional Outbox* (o *Redis Streams*).

**Cuánto reduce la carga sobre MySQL.** Medido con `Com_select` (el contador de consultas `SELECT` que ve MySQL), con 100 lecturas seguidas de
`GET /api/activos`:

| | Consultas a MySQL |
|---|---|
| Con Redis como modelo de lectura | **0** |
| Sin Redis (cada lectura va a MySQL) | **100** |

La mayoría del tráfico de una API es de lectura: con este camino la base principal queda para lo que solo ella puede hacer (guardar y garantizar la
integridad), y las lecturas escalan con Redis, que responde de memoria.

### Los suscriptores (Pub/Sub)

El comando **solo valida, persiste y publica**. Lo demás lo hacen dos **suscriptores**, procesos aparte (misma imagen, otro comando; en Docker son
los servicios `suscriptor-proyecciones` y `suscriptor-notificaciones`). Cada uno recibe **todos** los eventos y hace lo suyo; no se conocen entre sí
ni conocen a la API, y se pueden parar, reiniciar o escalar por separado.

| Suscriptor | Qué hace con cada evento | Usa |
|---|---|---|
| **Proyecciones** ([`crearProyecciones`](src/eventos/crearProyecciones.ts)) | 1. Invalida `activo:<id>` y `activos:todos` (y saca del ranking al activo eliminado). 2. Suma uno a `estadisticas:eventos-activos` (`HINCRBY`). 3. Registra la auditoría en MongoDB, **idempotente por `idEvento`** | Redis y MongoDB |
| **Notificaciones** ([`crearNotificaciones`](src/eventos/crearNotificaciones.ts)) | **Whale Alert**: si la posición queda por encima del `limiteAlertaUsd` del usuario que operó (o del `UMBRAL_MONTO_USD` si no configuró uno), escribe `Notificación enviada al usuario …`. En una actualización, solo si el monto cambió | Redis |

```
[INFO] SuscriptorProyecciones: Evento ACTIVO_CREADO procesado (c6bbaaea-…, activo 9502a5a9-…)
[INFO] SuscriptorNotificaciones: Notificación enviada al usuario auth0|6ae5…: Whale Alert, BTC vale 30000 USD y supera su límite de 10000 USD (ACTIVO_CREADO, evento c6bbaaea-…)
```

- **Dos conexiones a Redis por suscriptor.** Una conexión que se suscribe queda en modo suscripción y ya no puede ejecutar otros comandos; por eso el suscriptor
  abre una segunda (`duplicate()`) para escuchar el canal, y la conexión de datos sirve para invalidar, contar y leer preferencias.
- **Invalida, no escribe.** El suscriptor no guarda en la caché el dato del evento sino que lo borra: dos eventos del mismo activo pueden llegar en un orden
  distinto del que ocurrieron (los publican distintas instancias de la API) y escribir uno viejo dejaría la caché mal. Borrar nunca deja un dato equivocado.
- **Idempotente.** Cada registro de auditoría lleva el `idEvento` en un índice único (parcial: solo los documentos que lo tienen). Recibir el mismo evento
  dos veces audita una sola. Comprobado publicando a mano el mismo evento dos veces: un documento y, en el log, *ya estaba auditado: se ignora*.
- **Un mensaje malo no tumba al suscriptor.** Si no es JSON o no cumple el contrato se descarta con un WARN; si procesarlo falla, se deja el error en el log y
  se sigue con el próximo. Los eventos se procesan de a uno y en el orden en que llegaron.
- **Cierre ordenado.** Con SIGTERM (`docker compose stop`) deja de escuchar, termina el evento en curso y cierra Redis y MongoDB.
- **Reconexión.** Si Redis se cae y vuelve, el suscriptor se suscribe de nuevo solo (se comprobó reiniciando Redis: el `PUBLISH` siguiente volvió a tener
  2 receptores). Lo ocurrido mientras estuvo caído **no se recupera** (el log lo avisa al reconectar).
- **En local, sin Docker.** `npm run dev` **no** arranca los suscriptores: hay que levantarlos aparte (`npm run suscriptor:proyecciones` y
  `npm run suscriptor:notificaciones`, cada uno en su terminal). Sin ellos las escrituras funcionan, pero no se invalida la caché ni se audita ni se
  avisa nada, y la API lo deja como WARN (`receptores: 0`) en cada operación.

#### El reto: ¿qué pasa si el suscriptor está caído? (Pub/Sub vs BullMQ)

Pub/Sub es *fire and forget*: el mensaje llega a quienes están suscriptos **en ese instante** y Redis no lo guarda. Se comprobó parando el suscriptor de proyecciones:

| | Pub/Sub (suscriptor de proyecciones parado) | BullMQ (worker de reportes parado) |
|---|---|---|
| Qué pasa al publicar / encolar | `receptores: 1` (solo el otro suscriptor): el evento **no le llegó** al caído | El trabajo queda **guardado** en Redis, estado `en_cola` |
| Al volver el proceso | **No se entera de lo que pasó**: el historial no tiene el `CREAR` y la lista cacheada quedó vieja (`X-Cache: HIT` sin el activo nuevo) hasta que venza el TTL | Toma el trabajo pendiente y lo completa (`completado`) |
| ¿Se reenvía? | No, nunca | Sí, y con reintentos si falla |

La diferencia es el modelo: una **cola** guarda el trabajo hasta que alguien lo hace; un **canal** solo difunde. Pub/Sub es adecuado cuando perder un mensaje
es tolerable o se corrige solo (acá, la caché se corrige con el TTL); no lo es para la auditoría, que debería ser durable. La mejora es cambiar el canal
por **Redis Streams** (con grupos de consumidores: el suscriptor retoma desde el último evento que confirmó) o por una cola de BullMQ para la auditoría, y
publicar con un *Transactional Outbox* para no perder el evento tampoco del lado de la API. Ver [RESPUESTAS-PARTE-7.md](RESPUESTAS-PARTE-7.md).

**Consistencia eventual.** Entre que un comando confirma en MySQL y el suscriptor invalida la caché y escribe la auditoría hay una ventana (milisegundos con los
suscriptores sanos) en la que una consulta puede devolver el dato anterior o el historial puede no tener todavía la operación. Es el precio de CQRS; el TTL
(`CACHE_TTL_SEGUNDOS`) acota cuánto puede durar un desfasaje si un evento se pierde. Por eso la colección de Postman espera 300 ms antes de cada pedido.

**Limitaciones conocidas** (consecuencias del diseño, no defectos):

- **Leer lo recién escrito.** Un `DELETE` o un `PUT` seguido al instante de un `GET` puede devolver el dato anterior (`X-Cache: HIT`) hasta que el suscriptor
  invalide la caché; si el suscriptor está parado o el evento se perdió, hasta que venza el TTL.
- **El historial puede ir atrasado.** Los registros de auditoría los escribe el suscriptor: una operación puede tardar en aparecer, y si el suscriptor estuvo caído
  **nunca aparece**. En el caso extremo de un activo cuyos eventos nunca se auditaron y que ya se eliminó, `GET /api/activos/:id/historial` responde 404 como si el id
  nunca hubiera existido.
- **Orden entre instancias.** El registro se ordena por la hora en que se **publicó** el evento. Si dos `PUT` del mismo activo los atienden instancias distintas, pueden
  publicarse en otro orden del real y el historial mostrarlos invertidos (el `antes` y el `despues` de cada uno son correctos). Haría falta un número de secuencia por activo.
- **Sin alarma de eventos sin receptores.** Hoy es un WARN en el log de la API; no hay un chequeo de salud ni una métrica que avise que no hay suscriptores.

---

## Roles y modo pánico

La autenticación responde *quién sos* (401 si no se sabe); la **autorización** responde *qué podés hacer* (**403** si se
sabe quién es pero no tiene permiso). Los tres roles (RBAC) vienen dentro del token y cada ruta declara cuál exige
([`src/rutas/activosRutas.ts`](src/rutas/activosRutas.ts), matriz en [`src/seguridad/permisos.ts`](src/seguridad/permisos.ts)):

| Operación | AUDITOR | TRADER | ADMIN |
|---|:-:|:-:|:-:|
| Leer: activos, precios, historial de un activo, preferencias | ✔ | ✔ | ✔ |
| `GET /api/auditoria` (historial general) | ✔ | ✘ | ✔ |
| Crear, modificar y borrar activos; cambiar preferencias | ✘ | ✔ | ✔ |
| `POST /api/activos/analizar` (calcula, no guarda) | ✘ | ✔ | ✔ |
| Reportes, estadísticas, limpiar la caché y modo pánico | ✘ | ✘ | ✔ |

Un usuario autenticado **sin ningún rol** recibe 403 en todo menos en `GET /api/yo`. **Un test falla** si se agrega una ruta
sin permiso o con uno distinto del de esta tabla ([`pruebas/rutas/permisosDeRutas.test.ts`](pruebas/rutas/permisosDeRutas.test.ts)).
Cada acceso denegado queda en el log (quién, con qué roles, qué intentó).

**Modo pánico (distribuido).** Un interruptor de emergencia: un ADMIN lo activa durante un incidente y, mientras esté activo,
**todas las escrituras** de TRADER y AUDITOR dan **403** (el ADMIN nunca se bloquea: tiene que poder operar y apagarlo). Las
lecturas y `analizar` (que no escribe) siguen funcionando.

```bash
curl -X PUT http://localhost:3000/api/admin/modo-panico -H "Authorization: Bearer <token ADMIN>" \
     -H "Content-Type: application/json" -d '{"activo": true}'        # SET modo_panico true
curl http://localhost:3000/api/admin/modo-panico -H "Authorization: Bearer <token ADMIN>"   # {"modoPanico": true}
```

- **Vive en Redis, no en la memoria del proceso:** cuando la API corra en varias instancias (cluster, Parte 8), una variable en
  memoria cambiaría solo en la instancia que recibió el pedido; en Redis lo ven todas al instante, sin reiniciar nada.
- **Falla cerrado:** si no se puede leer el interruptor (Redis caído), las escrituras de quien no es ADMIN dan **503** en vez de
  dejarse pasar. Ante la duda, durante un incidente, no se escribe. Verificado con Redis detenido.
- **Costo de fallar cerrado:** el interruptor se consulta en Redis en **cada escritura** de quien no es ADMIN, así que una caída
  breve de Redis (por ejemplo mientras se reconecta) hace que esas escrituras den 503 aunque MySQL esté sano y el modo esté apagado.
  Es el compromiso elegido: durante un incidente es preferible rechazar a dejar pasar. Se podría guardar el valor unos segundos en
  cada instancia, a cambio de que el cambio tarde ese rato en verse.
- Quién lo activa o apaga, y cada escritura bloqueada, quedan en el log (los accesos denegados con nivel `warn`).

**Limpiar la caché** (`DELETE /api/admin/cache`, solo ADMIN) borra **únicamente** las entradas `activo:*`, recorriendo Redis con
`SCAN` por tandas. Nunca `FLUSHALL`/`FLUSHDB`: Redis también guarda los trabajos de la cola, las preferencias de cada usuario, el
contador de reportes, el ranking y el propio modo pánico, y borrarlos en pleno incidente sería peor que el problema.
Verificado: después de limpiar, las claves `bull:*`, `preferencias:*`, `estadisticas:*` y el ranking siguen intactas.

**Quién hizo qué.** La auditoría del CRUD y la de los reportes guardan el `sub` del usuario en `metadatos.usuario`.

---

## Nombres: de la letra al proyecto

La letra usa nombres en inglés; el proyecto mantiene todo en español (como en la Parte 3, donde
`/assets/analyze` pasó a `/api/activos/analizar`).

| En la letra | En el proyecto |
|---|---|
| cola `report-queue` | `cola-reportes` |
| `POST /assets/report` | `POST /api/activos/reporte` (y `GET /api/reportes/:id` para seguirlo) |
| Caché de activos (`.set()` / `.get()`) | `GET /api/activos/:id` con `X-Cache` |
| Preferencias (`.hSet()` / `.hGetAll()`) | `GET` y `PUT /api/preferencias` |
| contador atómico (`incr`) | `estadisticas:reportes-exitosos` (`GET /api/estadisticas`) |
| `GET /assets/:id/history` | `GET /api/activos/:id/historial` |
| `GET /health` | `GET /salud` |

---

## Endpoints

Todos los de `/api` requieren `Authorization: Bearer <token>` y un **rol** que lo permita (ver *Roles y modo pánico*; los de la tabla marcados con **ADMIN** son solo de ese rol). Pueden responder **401** (sin token, inválido o vencido) o **503**
(si no se pueden verificar los tokens porque el proveedor de identidad no responde). `/salud` es público.

| Método | Ruta | Descripción | Éxito | Errores |
|---|---|---|---|---|
| GET | `/salud` | Health check (**público**, sin token) | 200 | — |
| GET | `/api/yo` | Quién es el usuario del token y qué roles tiene (cualquier usuario autenticado) | 200 | 401 |
| GET | `/api/activos` | Lista los activos (`?simbolo=BTC` filtra). Sale de Redis; header `X-Cache: HIT` o `MISS` | 200 | — |
| GET | `/api/activos/:id` | Obtiene un activo (con caché: header `X-Cache: HIT` o `MISS`) | 200 | 404 |
| POST | `/api/activos` | Crea un activo | 201 | 400, 409, 502 |
| PUT | `/api/activos/:id` | Reemplaza un activo | 200 | 400, 404, 409, 502 |
| DELETE | `/api/activos/:id` | Elimina un activo | 204 | 404 |
| POST | `/api/activos/analizar` | Analiza un lote de activos (no guarda nada) | 200 | 400 |
| GET | `/api/activos/:id/historial` | Historial de un activo, también si ya fue eliminado | 200 | 404, 503 |
| GET | `/api/auditoria` | Historial general (`?operacion=`, `?limite=`) | 200 | 400, 503 |
| GET | `/api/activos/:id/precio` | Activo + cotización + rendimiento | 200 | 404, 502 |
| GET | `/api/precios/:simbolo` | Cotización de un símbolo suelto | 200 | 400, 404, 502 |
| POST | `/api/activos/reporte` | Pide el Reporte de Valoración Masiva: se encola y responde enseguida (header `Location`) | 202 | 503 |
| GET | `/api/reportes/:id` | Estado y progreso de un reporte, y su resultado cuando termina | 200 | 404, 503 |
| DELETE | `/api/admin/cache` | Vacía la caché de activos (solo `activo:*`). **ADMIN** | 200 | 403, 503 |
| GET | `/api/admin/modo-panico` | Estado del modo pánico. **ADMIN** | 200 | 403, 503 |
| PUT | `/api/admin/modo-panico` | Activa o apaga el modo pánico (`{"activo": true}`). **ADMIN** | 200 | 400, 403, 503 |
| GET | `/api/estadisticas` | Reportes exitosos, eventos de activos procesados por tipo y los 5 activos más consultados (Redis) | 200 | 503 |
| GET | `/api/preferencias` | Las preferencias del usuario del token (Redis) | 200 | 403, 503 |
| PUT | `/api/preferencias` | Cambia las preferencias del usuario enviadas (`monedaVisualizacion`, `limiteAlertaUsd`) | 200 | 400, 503 |

### Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 | GET o PUT exitoso |
| 201 | POST exitoso (incluye header `Location`) |
| 202 | El pedido de reporte quedó en la cola; el reporte todavía no existe (incluye `Location`) |
| 204 | DELETE exitoso (sin cuerpo) |
| 403 | El usuario está autenticado pero su rol no permite la operación, o el modo pánico está activo y es una escritura |
| 401 | Falta el token, es inválido o está vencido (incluye `WWW-Authenticate`) |
| 400 | Datos inválidos, JSON malformado, símbolo con formato inválido |
| 404 | Id inexistente, ruta inexistente, o símbolo sin cotización disponible |
| 409 | Ya existe un activo con ese símbolo |
| 502 | La API externa de precios o de tipo de cambio falló (timeout, red, respuesta inesperada) |
| 503 | No se pudo consultar el modo pánico (Redis caído): las escrituras de quien no es ADMIN se rechazan; no se pudo verificar el token (el proveedor de identidad no responde); MongoDB no responde y se pidió el historial de auditoría, o Redis no responde y se pidieron las preferencias, las estadísticas o un reporte (la cola vive en Redis) |
| 500 | Error no controlado |

### Formato de error

Todos los errores comparten la misma estructura:

```json
{
  "error": {
    "mensaje": "Datos del activo inválidos",
    "detalles": ["cantidad debe ser mayor a 0"]
  }
}
```

---

## Modelo `Activo`

```json
{
  "id": "2d335d2c-5a18-43ad-a1d4-498732cb0d2e",
  "simbolo": "BTC",
  "nombre": "Bitcoin",
  "cantidad": 0.5,
  "precioCompra": 40000,
  "creadoEn": "2026-08-27T14:32:43.928Z",
  "actualizadoEn": "2026-08-27T14:32:43.928Z"
}
```

El `id` lo genera siempre el servidor con `crypto.randomUUID()`; si el cliente envía uno
en el cuerpo, se ignora.

### Validaciones

| Campo | Regla |
|---|---|
| `simbolo` | 1–10 caracteres alfanuméricos; se normaliza a mayúsculas (`btc` → `BTC`) |
| `nombre` | Texto no vacío, máximo 50 caracteres |
| `cantidad` | Número entre `0.00000001` y `1000000000000000` (8 decimales) |
| `precioCompra` | Número entre `0.01` y `1000000000000000` (2 decimales) |
| `moneda` | Opcional. Código de 3 letras (`EUR`, `uyu`...); si falta se asume `USD` |

Si `moneda` no es USD, el servidor consulta el tipo de cambio y **guarda `precioCompra`
convertido a USD** con dos decimales: `{"precioCompra": 2000, "moneda": "EUR"}` se guarda
como `2241.88`. El activo guardado no lleva el campo `moneda`. Una moneda inexistente da
400; si la API de tipo de cambio no responde, 502.

Los rangos de `cantidad` y `precioCompra` son los que entran en las columnas `DECIMAL` de la
tabla: un valor positivo pero más chico (como `cantidad: 0.000000001`) MySQL lo redondearía a
cero y violaría el `CHECK`, así que se rechaza con 400 en lugar de fallar con un 500. Con más
decimales de los que admite la columna, el valor se redondea y la respuesta devuelve **lo que
quedó guardado** (`precioCompra: 98.456` responde `98.46`).

Se devuelven **todos** los errores de validación juntos, no solo el primero.
Además, el **símbolo es único** dentro del portafolio: hay una sola posición por activo.

---

## Integración con la API externa

Se usa **CoinGecko** (`/simple/price`), gratuita y sin API key ni registro.

```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
→ { "bitcoin": { "usd": 79837 } }
```

CoinGecko identifica las monedas por un id interno (`bitcoin`) y no por el símbolo
(`BTC`), así que [`src/servicios/preciosServicio.ts`](src/servicios/preciosServicio.ts)
mantiene un mapa de traducción con los símbolos soportados:

`BTC · ETH · USDT · BNB · SOL · XRP · ADA · DOGE · DOT · MATIC · LTC · AVAX`

La llamada se hace con el `fetch` **nativo** de Node (sin `axios`) y un timeout mediante
`AbortSignal.timeout()`, para que una caída de CoinGecko no deje colgada la petición.

`GET /api/activos/:id/precio` devuelve el activo enriquecido con el rendimiento:

```json
{
  "id": "2d335d2c-...",
  "simbolo": "BTC",
  "nombre": "Bitcoin",
  "cantidad": 1.25,
  "precioCompra": 40000,
  "precioActual": 79837,
  "moneda": "usd",
  "valorActual": 99796.25,
  "costoTotal": 50000,
  "gananciaPerdida": 49796.25,
  "variacionPorcentual": 99.59,
  "consultadoEn": "2026-08-27T14:33:31.702Z"
}
```

---

## Pipelines (Pipes & Filters)

Un **filtro** hace una sola operación sobre el dato; un **pipeline** encadena filtros y los
ejecuta en orden pasando la salida de uno como entrada del siguiente. Si un filtro falla,
el pipeline corta ahí (*fail fast*) y los siguientes no se ejecutan. El runner genérico es
[`src/pipeline/pipeline.ts`](src/pipeline/pipeline.ts) y es **inmutable y tipado**: el
compilador rechaza un orden de filtros incompatible.

### Ingesta — `POST` y `PUT /api/activos`

```
body → FiltroValidacion → FiltroNormalizacion → FiltroConversionMoneda → guardar
```

| Filtro | Qué hace |
|---|---|
| `FiltroValidacion` | Comprueba la estructura con **Zod**. Solo valida, no transforma. Devuelve todos los errores juntos (400) |
| `FiltroNormalizacion` | Símbolo en mayúsculas y sin espacios; nombre sin espacios sobrantes; moneda en mayúsculas (default `USD`) |
| `FiltroConversionMoneda` | Si la moneda no es USD, consulta el tipo de cambio ([open.er-api.com](https://open.er-api.com), sin API key) y convierte `precioCompra` a USD |

```json
POST /api/activos
{ "simbolo": " eth ", "nombre": "Ethereum", "cantidad": 3, "precioCompra": 2000, "moneda": "EUR" }

→ 201  { "simbolo": "ETH", "precioCompra": 2241.88, ... }    // 2000 EUR a la tasa del día
```

### Análisis — `POST /api/activos/analizar`

Recibe un **array** de activos, los procesa y devuelve un reporte. **No guarda nada.** Los
montos se interpretan en USD.

```
lote → FiltroDepuracion → FiltroAnalisisRiesgo → FiltroFormato → reporte
```

| Filtro | Qué hace |
|---|---|
| `FiltroDepuracion` | Descarta lo que no se puede analizar: no es un objeto, símbolo inválido (mismas reglas que la ingesta), nombre de más de 50 caracteres, `cantidad` o `precioCompra` en cero, negativos o no numéricos, monto que desborda, `volatilidad` inválida (un `null` cuenta como no informada). Cada descarte se loguea con su índice y motivo |
| `FiltroAnalisisRiesgo` | Marca `high_risk` si el monto (`cantidad × precioCompra`) **supera** `UMBRAL_MONTO_USD` (`whale_alert`) o si la `volatilidad` informada **supera** `UMBRAL_VOLATILIDAD` (`alta_volatilidad`) |
| `FiltroFormato` | Redondea `monto`, `precioCompra` y `volatilidad` a dos decimales, agrega metadatos de auditoría y arma el resumen |

```json
POST /api/activos/analizar
[
  { "simbolo": "btc", "cantidad": 10, "precioCompra": 50000.456 },
  { "simbolo": "SOL", "cantidad": 1, "precioCompra": 100, "volatilidad": 90.456 },
  { "simbolo": "ADA", "cantidad": 0, "precioCompra": 1 }
]

→ 200
{
  "auditoria": {
    "idAnalisis": "b0860756-7058-48d1-b849-d2c4724c4c80",
    "analizadoEn": "2026-10-06T03:32:05.280Z",
    "filtrosAplicados": ["FiltroDepuracion", "FiltroAnalisisRiesgo", "FiltroFormato"]
  },
  "resumen": { "recibidos": 3, "descartados": 1, "analizados": 2, "altoRiesgo": 2 },
  "activos": [
    { "simbolo": "BTC", "cantidad": 10, "precioCompra": 50000.46, "monto": 500004.56,
      "riesgo": "high_risk", "motivosRiesgo": ["whale_alert"] },
    { "simbolo": "SOL", "cantidad": 1, "precioCompra": 100, "volatilidad": 90.46, "monto": 100,
      "riesgo": "high_risk", "motivosRiesgo": ["alta_volatilidad"] }
  ]
}
```

Un elemento inválido **se descarta, no invalida el lote**. Si el body no es un array, 400.
La `cantidad` no se redondea: es la fracción del activo y a dos decimales `0.00345` BTC
pasaría a ser `0`. El riesgo se evalúa con el monto exacto, antes de redondear.

### Logging

Cada filtro registra su actividad con **Winston** y el pipeline registra cuáles terminaron
bien y cuál falló:

```
[INFO] FiltroValidacion: Estructura del activo válida
[INFO] Pipeline ingesta: FiltroValidacion ejecutado con éxito
[INFO] FiltroNormalizacion: Símbolo BTC normalizado
[INFO] Pipeline ingesta: FiltroNormalizacion ejecutado con éxito
[INFO] FiltroConversionMoneda: Convertido 2000 EUR a 2241.88 USD (tasa 1.12094)
[ERROR] Pipeline ingesta: Falló FiltroConversionMoneda: La moneda XXX no está soportada
```

Con `NODE_ENV=production` el log sale en JSON con *timestamp*; con `NODE_ENV=test` se
silencia.

### Tests

```bash
npm test
```

Los tests están en [`pruebas/`](pruebas/) y cubren cada filtro **por separado**, el
runner y cada pipeline completo, incluido el **orden de ejecución** (se comprueba contra el
orden de las líneas de log). Los filtros reciben sus dependencias por parámetro (logger,
tasa de cambio, umbrales, reloj), así que se prueban sin red ni variables de entorno.

---

## Estructura del proyecto

```
src/
├── servidor.ts                    # punto de entrada: app.listen()
├── app.ts                         # arma Express: middlewares + rutas + errores
├── config/
│   ├── env.ts                     # único archivo que lee process.env
│   └── logger.ts                  # logger Winston
├── modelos/activo.ts              # tipos del dominio
├── datos/
│   ├── activosRepositorio.ts      # acceso a la tabla activos (Sequelize); lanza SimboloDuplicadoError
│   ├── mapeoActivo.ts             # fila de MySQL <-> Activo del dominio (funciones puras)
│   ├── auditoriaRepositorio.ts    # historial de auditoría sobre MongoDB (Mongoose)
│   ├── mapeoAuditoria.ts          # documento de MongoDB -> RegistroAuditoria (función pura)
│   ├── conexiones.ts              # conexión a MySQL (Sequelize) y MongoDB (Mongoose)
│   ├── redis.ts, tiposRedis.ts    # cliente de Redis con su ciclo de vida y los comandos que usan los servicios
│   ├── modelos/activoModelo.ts    # modelo Sequelize de la tabla activos
│   ├── migraciones/               # cambios de esquema versionados (up / down)
│   └── migrar.ts, migrarCli.ts    # ejecutor de migraciones (Umzug) y su comando
├── eventos/                       # contrato del evento (eventoActivo.ts), publicador y suscriptores (crearSuscriptor, crearProyecciones, crearNotificaciones) de Redis Pub/Sub
├── seguridad/                     # verificadorJwt (jose, JWKS), autenticacion, autorizar (roles), modoPanico, permisos (la matriz), usuarioActual
├── colas/colaReportes.ts          # la cola de BullMQ vista desde la API (productor)
├── reportes/                      # generarReporte, procesadorReporte, eventosWorker, estadoReporte (sin Redis ni bases: dependencias por parámetro)
├── procesos/                      # puntos de entrada de los procesos aparte: workerReportes, suscriptorProyecciones, suscriptorNotificaciones (+ ejecutarSuscriptor, lo común)
├── pipeline/
│   ├── pipeline.ts                # runner genérico: Filtro y Pipeline
│   ├── ingesta/                   # validación → normalización → conversión de moneda
│   └── analisis/                  # depuración → riesgo → formato
├── validaciones/activoValidacion.ts
├── servicios/
│   ├── comandos/                  # lado de ESCRITURA (CQRS): crearComandosActivos (valida, persiste en MySQL y publica; + su cableado)
│   ├── consultas/                 # lado de LECTURA (CQRS): crearConsultasActivos, lee de Redis y cae a MySQL
│   ├── analisisServicio.ts        # usa el pipeline de análisis
│   ├── crearServicioAuditoria.ts  # consultar el historial (y registrar, de mejor esfuerzo: lo usan los reportes)
│   ├── auditoriaServicio.ts       # esa fábrica ya conectada a MongoDB y al logger
│   ├── crearCacheActivos.ts       # modelo de lectura: activo (String + TTL), lista completa y ranking (Sorted Set), de mejor esfuerzo
│   ├── cacheActivosServicio.ts    # esa fábrica ya conectada a Redis
│   ├── crearServicioPreferencias.ts, preferenciasServicio.ts   # preferencias (Hash de Redis)
│   ├── crearServicioReportes.ts, reportesServicio.ts           # pedir y consultar reportes (productor de la cola)
│   ├── crearServicioEstadisticas.ts, estadisticasServicio.ts   # reportes exitosos (INCR) y ranking
│   ├── preciosServicio.ts         # llamada a CoinGecko
│   └── tasasServicio.ts           # llamada a la API de tipo de cambio
├── controladores/                 # activos, auditoría, preferencias y reportes
├── rutas/activosRutas.ts
├── errores/ErrorApi.ts
├── utilidades/                    # redondear.ts, camposModificados.ts, whaleAlert.ts (la regla de la alerta, compartida)
└── middlewares/                   # manejadorErrores.ts y autenticacion.ts (Bearer + JWT)

herramientas/idpFalso.ts           # proveedor de identidad falso (solo desarrollo; no entra en la imagen)

pruebas/                           # tests de Jest (un archivo por filtro y por pipeline)
```

La regla que sostiene la separación:
**la ruta no sabe de lógica, el controlador no sabe de datos, el servicio no sabe de HTTP,
el repositorio no sabe de negocio.**

Flujo de una petición:

```
Cliente → rutas → controlador → COMANDOS → pipeline de ingesta → repositorio → MySQL
                      │              │            └──→ tasasServicio → API de tipo de cambio
                      │              │            └──→ PUBLISH → Redis Pub/Sub (mejor esfuerzo) ··· suscriptores: caché, auditoría → MongoDB, Whale Alert
                      ├────→ CONSULTAS → caché → Redis (modelo de lectura) ··· si no está → MySQL
                                    ├────→ preferencias → Redis
                                    └────→ reportes → cola (BullMQ/Redis) ··· worker → preciosServicio + MongoDB
                                    ├────→ pipeline de análisis (lote → reporte)
                                    └────→ preciosServicio → CoinGecko

Cualquier throw de ErrorApi → manejadorErrores → { "error": { ... } }
```

> **Persistencia:** los activos viven en MySQL y **sobreviven a un reinicio** de la API. Al
> arrancar, `servidor.ts` conecta MySQL, aplica las migraciones pendientes, conecta MongoDB
> y recién entonces escucha; si algo falla, la API no levanta y lo dice con un mensaje
> claro. Pasar de la memoria a la base reescribió solo `activosRepositorio.ts`: los
> servicios y controladores solo sumaron `async`/`await`.

---

## Pruebas con Postman

1. Levantar la API (`npm run dev`).
2. En Postman: **Import** → seleccionar
   [`postman/portafolio-cripto.postman_collection.json`](postman/portafolio-cripto.postman_collection.json).
3. Ejecutar los requests en orden, o usar el **Collection Runner** para correr los 76 de
   una sola vez. Los tres primeros (`T1` a `T3`) piden los tokens al proveedor de identidad: hace falta un **entorno**
   (`postman/entorno-local.postman_environment.json.ejemplo` para Auth0, o `postman/entorno-idp-falso.postman_environment.json`
   para el proveedor falso). Ver [AUTH0.md](AUTH0.md). Los requests del reporte necesitan el worker corriendo (`npm run worker` o el compose).
   Los que cotizan dependen de CoinGecko, que en su plan gratuito limita las consultas (HTTP 429): si se
   corre la colección muchas veces seguidas, el reporte puede quedar `fallido` y el test lo informa.

La colección trae dos variables: `baseUrl` (`http://localhost:3000`) e `idActivo`, que se
completa sola — el request *03 - Crear activo BTC* guarda el id devuelto y los siguientes
lo reutilizan, así no hace falta copiar y pegar UUIDs a mano.

> La colección se puede correr las veces que haga falta: el request *00 - Limpiar el
> portafolio* borra los activos de corridas anteriores (los datos ahora persisten en MySQL).

### Equivalente en `curl`

```bash
# Health check
curl http://localhost:3000/salud

# Crear un activo → 201
curl -X POST http://localhost:3000/api/activos \
  -H "Content-Type: application/json" \
  -d '{"simbolo":"BTC","nombre":"Bitcoin","cantidad":0.5,"precioCompra":40000}'

# Listar / filtrar → 200
curl http://localhost:3000/api/activos
curl "http://localhost:3000/api/activos?simbolo=BTC"

# Obtener por id → 200
curl http://localhost:3000/api/activos/<ID>

# Precio actual y rendimiento → 200
curl http://localhost:3000/api/activos/<ID>/precio

# Cotización de un símbolo suelto → 200
curl http://localhost:3000/api/precios/ETH

# Actualizar → 200
curl -X PUT http://localhost:3000/api/activos/<ID> \
  -H "Content-Type: application/json" \
  -d '{"simbolo":"BTC","nombre":"Bitcoin","cantidad":1.25,"precioCompra":42000}'

# Eliminar → 204
curl -X DELETE http://localhost:3000/api/activos/<ID>

# --- Casos de error ---
curl -X POST http://localhost:3000/api/activos \
  -H "Content-Type: application/json" -d '{"simbolo":"","cantidad":-1}'   # 400
curl -X POST http://localhost:3000/api/activos \
  -H "Content-Type: application/json" -d '{roto'                          # 400
curl http://localhost:3000/api/activos/no-existe                          # 404
curl http://localhost:3000/api/precios/NOEXISTE                           # 404
curl http://localhost:3000/api/ruta-inexistente                           # 404
```

---

## Decisiones técnicas

| Decisión | Motivo |
|---|---|
| Sin `dotenv` | `node --env-file=.env` es nativo desde Node 20.6. Una dependencia menos. |
| Sin `tsx` / `ts-node` | Node ejecuta TypeScript directamente borrando los tipos. `tsc` se usa solo para el build. |
| Sin `axios` | `fetch` es global y nativo. |
| Zod en el filtro de validación | Una sola fuente de verdad para tipo y reglas del body. Se conservan los mensajes de error del contrato anterior. |
| Winston para el logging | Formato legible en desarrollo (`[INFO] Filtro: mensaje`), JSON en producción y silencio en tests. |
| Jest sin `ts-jest` | Un transformador de 3 líneas (`module.stripTypeScriptTypes`) hace lo mismo que Node al ejecutar los `.ts`: los tests corren el mismo código que la app, sin otro compilador. |
| Filtros con las dependencias por parámetro | Logger, tasa de cambio, umbrales, reloj e ids entran por parámetro: los filtros se prueban sin red ni variables de entorno. |
| `Filtro.ejecutar` como propiedad y no como método | TypeScript compara los métodos de forma bivariante y aceptaría un filtro que espera otra entrada. Como propiedad, un orden inválido no compila. |
| El análisis descarta elementos inválidos en vez de rechazar el lote | Un elemento malo no invalida a los demás; cada descarte queda en el log con su índice y motivo. |
| `cantidad` no se redondea en el análisis | Es la fracción del activo: a dos decimales `0.00345` BTC pasaría a ser `0`. |
| Precio guardado siempre en USD | La conversión ocurre al ingresar; el resto de la app (rendimiento contra CoinGecko) no necesita saber en qué moneda se compró. |
| Sin `uuid` | `crypto.randomUUID()` viene en el core. |
| `crypto.randomUUID()` en vez de un contador | Con `splice` los índices se reordenan; un contador obligaría a mantener el estado de la secuencia. |
| Repositorio separado del servicio | Aísla el acceso a los datos. Se comprobó en la práctica: pasar de un array a MySQL reescribió solo ese archivo. |
| El símbolo único lo hace cumplir la restricción `UNIQUE`, no una búsqueda previa | "Buscar y después guardar" no es seguro: dos pedidos simultáneos pasan la búsqueda a la vez. Con 5 `POST` simultáneos del mismo símbolo, 1 da 201 y 4 dan 409. |
| El repositorio relee la fila después de escribir | MySQL redondea los `DECIMAL` en silencio; así el `POST` y el `GET` siguiente dicen lo mismo. |
| Mapeo fila ↔ `Activo` en funciones puras | Concentra las dos diferencias de representación (DECIMAL como texto, fechas como `Date`) y se prueba sin base de datos. |
| Rangos numéricos validados de antemano | Lo que la tabla no puede representar daría un 500; así da un 400 con un mensaje. |
| `PUT` lee y escribe en una transacción con la fila bloqueada (`SELECT ... FOR UPDATE`) | Si dos `PUT` llegan a la vez, el segundo espera al primero: el `antes` de la auditoría es lo que de verdad se pisó. Con 6 `PUT` simultáneos, cada `antes` es el `despues` del anterior. |
| El healthcheck de Mongo se autentica | El `mongod` temporal de la inicialización no tiene autenticación y respondería "sano" a un ping anónimo antes de que exista el usuario. |
| El healthcheck de MySQL prueba por TCP (`127.0.0.1`) | Con un volumen nuevo, la imagen arranca un servidor temporal que solo atiende por socket y que con `localhost` se veía "sano": la API intentaba conectarse antes de tiempo, fallaba y dependía de que `restart` la levantara de nuevo. |
| La API del compose espera a que las bases estén `healthy` | `depends_on` con `condition: service_healthy`: no arranca contra una base que todavía no atiende. |
| La auditoría es de mejor esfuerzo (y la escribe un suscriptor) | No hay transacción entre MySQL y MongoDB: si el historial falla, la operación ya confirmada no se deshace ni se le falla al cliente. Se paga con posibles operaciones sin registro. |
| Tiempo máximo de 2 s para registrar | Con MongoDB caído, el driver tardaría 5 s en rendirse en cada escritura; así la demora es acotada. |
| El historial se lee antes de borrar y sin tocar MySQL | El `ELIMINAR` guarda cómo era el activo; la consulta funciona aunque ya no exista. |
| Consultas de historial con MongoDB caído → 503 | No es un bug de la API (500) sino un servicio del que depende que no está disponible. |
| La caché es de mejor esfuerzo; las preferencias no | La caché es una copia: si Redis falla se sirve desde MySQL y solo se loguea. Las preferencias solo existen en Redis, así que sin él no hay qué devolver: 503. |
| `disableOfflineQueue` en el cliente de Redis | Con Redis caído, los comandos fallan en el acto en lugar de quedar encolados: una caída no demora las respuestas (un `GET` con Redis caído respondió en 6 ms). |
| Un TTL como red de seguridad | Si una invalidación se pierde (Redis caído en el `PUT`), el dato viejo vive como máximo `CACHE_TTL_SEGUNDOS`. |
| Solo la lectura pública por id usa la caché | Actualizar y eliminar deciden con el dato real de MySQL; no pueden apoyarse en una copia que puede estar desactualizada. |
| Redis con `noeviction` y AOF | Con la memoria llena rechaza escrituras en vez de borrar claves sin avisar (lo exige la cola de la Parte 5), y los datos sobreviven a un reinicio. |
| La contraseña de Redis no queda en `docker inspect` | Se pasa por variable de entorno y la expande el shell del contenedor, en vez de interpolarse en el comando. |
| La matriz de permisos se declara en cada ruta y un test la verifica | Una ruta nueva sin permiso quedaría abierta a cualquier usuario autenticado sin que nadie lo note; el test falla en ese caso. |
| 403 y no 404 para lo que el rol no permite | No se oculta que el recurso existe: el usuario está autenticado y la API es de uso interno; un 404 confundiría al cliente legítimo. |
| El ADMIN no se bloquea nunca en modo pánico | Tiene que poder operar y apagar el modo; si no, un incidente lo dejaría sin salida. |
| El modo pánico falla cerrado | Si no se puede leer el interruptor se rechazan las escrituras (503): ante la duda, durante un incidente, no se escribe. |
| Limpiar la caché con `SCAN` + borrado de `activo:*`, nunca `FLUSHALL` | Redis guarda también la cola, las preferencias, los contadores y el modo pánico; vaciarlo todo en un incidente los perdería. |
| Preferencias por usuario (`preferencias:<sub>`), con el `sub` del token | Nadie puede leer ni cambiar las de otro: el id sale del token verificado, nunca del pedido. |
| CQRS: servicios de comandos y de consultas separados, con sus dependencias por parámetro | Cada lado se prueba sin MySQL, Redis ni red, y se puede cambiar un modelo sin tocar el otro. |
| Un comando publica el evento DESPUÉS de confirmar en MySQL, y publicar es de mejor esfuerzo | Nunca se anuncia algo que no ocurrió; y MySQL ya confirmó, así que fallarle al cliente por un evento no tiene sentido. Se paga con eventos que pueden perderse. |
| El evento tiene un contrato versionado y se valida al publicar y al recibir | Publicador y suscriptores no se conocen, pero comparten esa forma. El canal no garantiza nada de quien escribe en él. |
| Los suscriptores son procesos aparte (misma imagen, otro comando), uno por tarea | Se pueden parar, reiniciar o escalar por separado y la API no sabe que existen. Si uno falla o está caído, el otro sigue. |
| El suscriptor de proyecciones INVALIDA la caché, no escribe el dato del evento | Los eventos de un mismo activo pueden llegar en otro orden del que ocurrieron (los publican distintas instancias de la API): escribir uno viejo dejaría la caché mal hasta el TTL. Invalidar nunca deja un dato equivocado: la próxima lectura va a MySQL. |
| La auditoría de un evento es idempotente (índice único parcial en `idEvento`) | Si el mismo evento llega dos veces (o un suscriptor se reinicia a mitad), no se duplica el historial. Parcial para que los registros viejos y los reportes, que no tienen `idEvento`, no choquen entre sí. |
| Cada suscriptor usa DOS conexiones a Redis (`subscribe` y `duplicate()`) | Una conexión suscripta queda en modo suscripción y no puede ejecutar otros comandos; los datos (invalidar, contar, leer preferencias) van por la otra. |
| Un evento por vez y en orden de llegada; uno inválido o que falla no frena a los demás | Un ACTIVO_ACTUALIZADO no se aplica antes que el ACTIVO_CREADO que lo precede. Pub/Sub no reenvía, así que reintentar no es posible: se deja el error en el log y se sigue. |
| Las Whale Alert usan el límite de cada usuario y, si no hay, el umbral general | Es lo que el usuario configuró en sus preferencias; si no se pueden leer (Redis caído) rige el umbral general: una alerta con el límite por defecto vale más que ninguna. |
| La lista completa se cachea como un solo valor y el filtro por símbolo se aplica en memoria | El portafolio es chico; un solo `GET` de Redis sirve cualquier filtro sin ir a la base. |
| El precio (`/precio`) toma el activo del modelo de lectura pero nunca cachea la cotización | El activo es un dato propio que cambia por comandos; la cotización es de un tercero y cambia sola. |
| Autenticación delegada en un proveedor de identidad (Auth0) y la API solo verifica | La API no maneja contraseñas ni sesiones; el token es *stateless*, así que sirve igual con una instancia que con diez (Parte 8). |
| Algoritmo fijo (`RS256`) y `iss`/`aud`/`exp` obligatorios | Sin la lista cerrada de algoritmos, `alg: none` o la confusión HS256/RS256 podrían pasar. |
| Los roles se leen de un claim configurable, y los desconocidos se descartan | No se ata la app a un proveedor ni se confía en roles inventados. |
| 503 y no 401 si no se pueden bajar las claves | Es una falla del proveedor, no del cliente; reenviar el token no ayudaría. |
| `/salud` queda público | Lo necesitan Docker y los monitores, que no tienen un token. |
| Proveedor de identidad falso como herramienta de desarrollo | Permite correr Newman y las pruebas de carga sin cuenta externa ni credenciales en el repo. |
| BullMQ en lugar de Bull | Bull está en modo mantenimiento y sus autores recomiendan BullMQ; los conceptos de la letra (cola, worker, `completed`/`failed`) son los mismos. |
| BullMQ con `ioredis` y no con el cliente oficial | El adaptador de `redis` (BullMQ 6) tumbaba el proceso ante una caída de Redis y no se recuperaba limpio; con `ioredis` sí. |
| El worker es un proceso aparte (misma imagen, otro comando) | Se detiene o reinicia sin tocar la API, y con la API en cluster (Parte 8) no se multiplican workers sin querer. |
| La cola falla en el acto con Redis caído | `enableOfflineQueue: false`: `add` falla en 1 ms y la API responde 503 en vez de colgarse. |
| El id del reporte es un UUID y un id que no lo es da 404 sin consultar Redis | Evita que `GET /api/reportes/meta` lea la configuración interna de la cola. |
| Un fallo al auditar un reporte hace fallar el trabajo | Un reporte se puede regenerar y la cola reintenta; a diferencia del CRUD, no hay una operación irreversible detrás. |
| Redis con `noeviction` | BullMQ no puede perder trabajos por desalojo: con la memoria llena Redis rechaza escrituras. |
| Migraciones al arrancar la API | Cómodo con una sola instancia. Con varias arrancando a la vez convendría un paso de migración aparte. |
| 409 por símbolo duplicado | El portafolio tiene una única posición por activo. |
| 404 vs 502 en precios | 404 si el símbolo no está soportado (no se llega a llamar a CoinGecko); 502 solo si CoinGecko falla de verdad, porque el error es de un servicio upstream y no nuestro. |
| Sin try/catch en los controladores | Express 5 deriva automáticamente al manejador de errores las excepciones y las promesas rechazadas. |
| `.env` fuera de la imagen Docker | La configuración se inyecta en tiempo de ejecución, no se hornea en la imagen. |

### Sobre la configuración de TypeScript

Tres flags de [`tsconfig.json`](tsconfig.json) hacen posible que el **mismo código** corra
sin compilar en desarrollo y compilado en producción:

- **`erasableSyntaxOnly`** — el *type stripping* de Node solo borra tipos, no transforma
  código. Este flag hace que `tsc` rechace la sintaxis que Node no puede borrar (`enum`,
  parameter properties).
- **`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`** — los imports se
  escriben con la extensión real (`from "./app.ts"`), que es lo que Node exige en ESM, y
  `tsc` las reescribe a `.js` al compilar a `dist/`.
- **`verbatimModuleSyntax`** — obliga a importar los tipos con `import type`.

### Fuera de alcance (posibles mejoras)

- El contador de reportes exitosos es aproximado: se incrementa al recibir el evento `completed`, así que se pierde un conteo si el
  worker cae justo en ese momento y se podría duplicar si un trabajo se reprocesa. Un `SADD` por id de reporte lo haría idempotente.
- Si Redis responde lento (más de 2 s) al pedir un reporte, la API da 503 pero el pedido puede quedar encolado igual: un reintento
  del cliente generaría dos reportes (con Redis caído no pasa). Se resolvería con una clave de idempotencia enviada por el cliente.
- Rate limiting (limitar cuántos pedidos por minuto puede hacer cada usuario o IP): hoy un usuario con permiso puede saturar la API o la cola de reportes.
- Registrar en MongoDB (y no solo en el log) quién activó el modo pánico y quién limpió la caché.
- Deduplicar pedidos de reporte repetidos y respetar el `Retry-After` de CoinGecko al reintentar.
- Invalidación robusta de la caché de activos: hoy depende del TTL si el evento se pierde (Redis caído al publicar o suscriptor detenido). Con *Redis Streams* (o un *Transactional Outbox*) el suscriptor retomaría desde donde quedó.
- Caché de ~60 s para las cotizaciones (en Redis, ahora que está disponible), y así no golpear el *rate limit*
  gratuito de CoinGecko.
- Resolver los símbolos vía `/coins/list` en vez del mapa fijo (se evitó porque descarga
  unas 15.000 monedas solo para traducir un identificador).
- *Transactional Outbox* para la auditoría: guardar el evento en MySQL dentro de la misma
  transacción que el cambio y copiarlo a MongoDB después, para no perder registros si Mongo cae.
- Caché de tasas de cambio: hoy cada alta en otra moneda consulta la API, y esa consulta
  ocurre antes de comprobar si el símbolo ya existe (409).
- Loguear los fallos del cliente (4xx) con un nivel menor que los del servidor: hoy un body
  inválido deja una línea `[ERROR]` en el pipeline.
- Test unitario de `tasasServicio` y `preciosServicio`: hoy importan `config/env.ts`, que
  corta el proceso si faltan variables; se verificaron contra las APIs reales.
