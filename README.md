# API REST — Portafolio de Criptoactivos

API REST para gestionar un portafolio de criptoactivos, con CRUD completo sobre
persistencia en MySQL, integración con APIs externas (cotizaciones y tipo de cambio)
y procesamiento con el patrón **Pipes & Filters**: un pipeline de ingesta para los activos
nuevos y otro de análisis de riesgo para lotes.

**Stack:** Node.js · Express 5 · TypeScript · Zod · Winston · Jest · Docker

---

## Requisitos

- Node.js **22 o superior** (probado en v24.11). Se necesita esa versión para el flag
  nativo `--env-file` y para ejecutar archivos `.ts` sin compilar.
- Docker con Compose v2 (`docker compose`), para levantar MySQL y MongoDB.

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
| `npm run db:verificar` | Comprueba que MySQL y MongoDB respondan con la configuración del `.env` |

Los comandos son, en realidad:

```bash
node --env-file=.env --watch src/servidor.ts    # dev
tsc                                             # build
node --env-file=.env dist/servidor.js           # start
node --experimental-vm-modules node_modules/jest/bin/jest.js   # test
```

La API queda disponible en `http://localhost:3000`.

---

## Bases de datos

El proyecto usa dos motores, cada uno para lo que mejor hace: **MySQL** (vía Sequelize) para
la entidad `Activo`, que tiene estructura fija y reglas de integridad, y **MongoDB** (vía
Mongoose) para la auditoría, que crece rápido y no necesita un esquema rígido.

```bash
docker compose up -d --wait     # levanta MySQL 8.4 y MongoDB 8.0 y espera a que estén healthy
npm run migrar                  # crea las tablas de MySQL
npm run db:verificar            # comprueba que la app llega a las dos bases
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

Cada vez que el servicio **crea, actualiza o elimina** un activo en MySQL, guarda un registro en
la colección `auditoria_activos` de MongoDB. Los registros no tienen forma fija, y por eso viven
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

> **Si MongoDB falla, la operación no se pierde.** MySQL y MongoDB son dos escrituras
> independientes y no hay una transacción que abarque las dos. Como MySQL ya confirmó lo que
> importa, la auditoría es de **mejor esfuerzo**: si no se puede registrar (o MongoDB no responde
> en 2 segundos), la API responde igual con éxito y deja el error en el log. El costo es que
> puede haber operaciones sin registro. Las consultas del historial, en cambio, responden 503 si
> MongoDB no está. La solución completa sería un *Transactional Outbox* (ver mejoras).

---

## Docker

```bash
# Construir la imagen
docker build -t portafolio-cripto .

# Ejecutar el contenedor
docker run --rm -p 3000:3000 --env-file .env portafolio-cripto

# Verificar
curl http://localhost:3000/salud
```

> **Las bases:** la API necesita MySQL y MongoDB para arrancar. Dentro de un contenedor,
> `localhost` es el propio contenedor, así que con el `.env` tal cual no llega a las bases
> (falla con `ECONNREFUSED`). Para probar la imagen contra las bases del host:
> `docker run --env-file .env -e MYSQL_HOST=host.docker.internal -e MONGO_HOST=host.docker.internal ...`.
> La API como un servicio más del `docker-compose.yml` se agrega en la última etapa.
>
> **Nota:** dentro del contenedor **no** se usa `--env-file` de Node. El archivo `.env`
> queda excluido de la imagen (ver `.dockerignore`) y las variables se inyectan al
> ejecutar, con `docker run --env-file .env`. Así la imagen no lleva configuración
> adentro y sirve para cualquier entorno.

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
| `UMBRAL_MONTO_USD` | `100000` | Monto (en USD) que, superado, dispara la *Whale Alert*. Admite 0 |
| `UMBRAL_VOLATILIDAD` | `80` | Volatilidad (en %) que, superada, marca un activo como `high_risk` |

Si falta alguna, la aplicación corta el arranque con un mensaje explícito
(*fail fast*, ver [`src/config/env.ts`](src/config/env.ts)).

---

## Endpoints

| Método | Ruta | Descripción | Éxito | Errores |
|---|---|---|---|---|
| GET | `/salud` | Health check | 200 | — |
| GET | `/api/activos` | Lista los activos (`?simbolo=BTC` filtra) | 200 | — |
| GET | `/api/activos/:id` | Obtiene un activo | 200 | 404 |
| POST | `/api/activos` | Crea un activo | 201 | 400, 409, 502 |
| PUT | `/api/activos/:id` | Reemplaza un activo | 200 | 400, 404, 409, 502 |
| DELETE | `/api/activos/:id` | Elimina un activo | 204 | 404 |
| POST | `/api/activos/analizar` | Analiza un lote de activos (no guarda nada) | 200 | 400 |
| GET | `/api/activos/:id/historial` | Historial de un activo, también si ya fue eliminado | 200 | 404, 503 |
| GET | `/api/auditoria` | Historial general (`?operacion=`, `?limite=`) | 200 | 400, 503 |
| GET | `/api/activos/:id/precio` | Activo + cotización + rendimiento | 200 | 404, 502 |
| GET | `/api/precios/:simbolo` | Cotización de un símbolo suelto | 200 | 400, 404, 502 |

### Códigos HTTP

| Código | Cuándo |
|---|---|
| 200 | GET o PUT exitoso |
| 201 | POST exitoso (incluye header `Location`) |
| 204 | DELETE exitoso (sin cuerpo) |
| 400 | Datos inválidos, JSON malformado, símbolo con formato inválido |
| 404 | Id inexistente, ruta inexistente, o símbolo sin cotización disponible |
| 409 | Ya existe un activo con ese símbolo |
| 502 | La API externa de precios o de tipo de cambio falló (timeout, red, respuesta inesperada) |
| 503 | MongoDB no responde y se pidió el historial de auditoría |
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
│   ├── modelos/activoModelo.ts    # modelo Sequelize de la tabla activos
│   ├── migraciones/               # cambios de esquema versionados (up / down)
│   └── migrar.ts, migrarCli.ts    # ejecutor de migraciones (Umzug) y su comando
├── pipeline/
│   ├── pipeline.ts                # runner genérico: Filtro y Pipeline
│   ├── ingesta/                   # validación → normalización → conversión de moneda
│   └── analisis/                  # depuración → riesgo → formato
├── validaciones/activoValidacion.ts
├── servicios/
│   ├── activosServicio.ts         # reglas de negocio del CRUD (usa el pipeline de ingesta)
│   ├── analisisServicio.ts        # usa el pipeline de análisis
│   ├── crearServicioAuditoria.ts  # registrar (mejor esfuerzo) y consultar el historial
│   ├── auditoriaServicio.ts       # esa fábrica ya conectada a MongoDB y al logger
│   ├── preciosServicio.ts         # llamada a CoinGecko
│   └── tasasServicio.ts           # llamada a la API de tipo de cambio
├── controladores/                 # activosControlador.ts y auditoriaControlador.ts
├── rutas/activosRutas.ts
├── errores/ErrorApi.ts
├── utilidades/                    # redondear.ts, camposModificados.ts
└── middlewares/manejadorErrores.ts

pruebas/                           # tests de Jest (un archivo por filtro y por pipeline)
```

La regla que sostiene la separación:
**la ruta no sabe de lógica, el controlador no sabe de datos, el servicio no sabe de HTTP,
el repositorio no sabe de negocio.**

Flujo de una petición:

```
Cliente → rutas → controlador → servicio → pipeline de ingesta → repositorio → MySQL
                                    │            └──→ tasasServicio → API de tipo de cambio
                                    │            └──→ auditoría → MongoDB (mejor esfuerzo)
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
3. Ejecutar los requests en orden, o usar el **Collection Runner** para correr los 27 de
   una sola vez.

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
| La auditoría es de mejor esfuerzo | No hay transacción entre MySQL y MongoDB: si el historial falla, la operación ya confirmada no se deshace ni se le falla al cliente. Se paga con posibles operaciones sin registro. |
| Tiempo máximo de 2 s para registrar | Con MongoDB caído, el driver tardaría 5 s en rendirse en cada escritura; así la demora es acotada. |
| El historial se lee antes de borrar y sin tocar MySQL | El `ELIMINAR` guarda cómo era el activo; la consulta funciona aunque ya no exista. |
| Consultas de historial con MongoDB caído → 503 | No es un bug de la API (500) sino un servicio del que depende que no está disponible. |
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

- Caché en memoria de ~60 s para las cotizaciones, y así no golpear el *rate limit*
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
