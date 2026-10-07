# Plan — Parte 3 (Pipes & Filters) y Parte 4 (Persistencia) · portafolio-cripto

## Estado

- [x] Sesión 0 — Planificación
- [x] Sesión 1 — Base del pipeline, logger y tests
- [x] Sesión 2 — Pipeline de ingesta
- [x] Sesión 3 — Pipeline de análisis y cierre de la Parte 3 (**Parte 3 en `main`**)
- [x] Sesión 4 — Infraestructura de datos y migraciones
- [x] Sesión 5 — Repositorio de activos sobre MySQL
- [x] Sesión 6 — Auditoría en MongoDB
- [x] Sesión 7 — API en Compose y cierre (revisiones pendientes; falta el merge a `main`)

El detalle de lo hecho en cada sesión está en [BITACORA.md](BITACORA.md).

## Contexto

El proyecto está en el estado de la Parte 1/2: API REST en capas
(`rutas → controladores → servicios → datos`) con un array en memoria, validación a mano
y CoinGecko para cotizaciones. En `Contextos/` hay dos letras nuevas y un ejemplo:

- **Parte 3** — Pipes & Filters: pipeline de ingesta (Zod, normalización, conversión de
  moneda), `POST /assets/analyze` con pipeline de análisis, logging con Winston/Pino y
  tests con Jest. **No está implementada.**
- **Parte 4** — Persistencia: MySQL + Sequelize + migraciones para `Asset`, MongoDB +
  Mongoose para `AuditLog`, repositorios adaptados, `docker-compose.yml` con API + ambas
  bases y variables de entorno nativas.
- **Ejemplo** (`Contextos/crypto-databases-ejemplo/`): `compose.yaml` con MySQL 8.4 y
  Mongo 8.0 con healthchecks, y un laboratorio con modelo Sequelize, schema Mongoose y
  un demo combinado. Se toma como referencia directa para la Parte 4.

Decidido con vos en la sesión de plan:

| Tema | Decisión |
|---|---|
| Orden | Parte 3 primero, después Parte 4 |
| Migraciones | Umzug (programático, `.ts`, sin `.cjs`) |
| Entidad `User` (opcional) | Queda fuera; se documenta como mejora futura |
| Sesión de plan | Opus 5.5 · esfuerzo alto · modo plan |

Supuesto a documentar: la Parte 4 habla de un `AuditRepository` "existente", pero ninguna
letra anterior lo define → se crea nuevo en la Parte 4, directo sobre Mongoose.

## Convenciones que se mantienen

- Nombres en español (carpetas, funciones, JSON, tablas y colecciones).
- Imports con extensión `.ts`, `import type`, sin `enum` ni parameter properties
  (`erasableSyntaxOnly`): el mismo código corre con `node src/servidor.ts` y compilado.
- `config/env.ts` sigue siendo el único archivo que lee `process.env` (fail fast).
- Cualquier capa lanza `ErrorApi`; `middlewares/manejadorErrores.ts` es el único que
  traduce a HTTP. Los controladores siguen sin try/catch.
- El contrato actual de la API no se rompe: la colección de Postman existente debe
  seguir pasando al final de cada sesión.
- Git: GitFlow. Una rama `feature/sesion-N-*` por sesión, merge `--no-ff` a `develop` y
  push de `develop` al cerrar la sesión. `main` (producción) solo se actualiza al cerrar
  la Parte 3 y la Parte 4, con todo verificado y sin tags. Detalle en `CLAUDE.md`.

## Sesiones

Cada sesión deja la app funcionando, verificada, y cierra con una entrada en
`BITACORA.md`. Al empezar cada sesión me decís modelo y esfuerzo (el esfuerzo no lo veo).

### Sesión 1 — Base del pipeline, logger y tests
Preparación (una sola vez):
- `PLAN.md` en la raíz (copia de este plan con checklist por sesión) y `BITACORA.md`
  con la entrada de la sesión 0 (ver más abajo).
- `CLAUDE.md` con convenciones y comandos, para que cada sesión arranque con contexto.
- Memoria: preferencia de bitácora + mensaje al profesor; `Contextos/` como fuente de letras.
- Proponer `git init` + un commit por sesión (lo confirmás vos).

Código:
- `src/pipeline/pipeline.ts` — tipo `Filtro<Entrada, Salida>` (`nombre` + `ejecutar`) y
  clase `Pipeline` con `.agregar()` encadenable y tipado. El runner ejecuta en orden,
  loguea cada filtro que termina bien y cuál falló, y corta en el primer error (fail fast).
- `src/config/logger.ts` — **Winston**: formato `[INFO] FiltroX: mensaje` en desarrollo,
  JSON en producción, silencioso en tests. Reemplaza los `console.*` de
  `servidor.ts` y `manejadorErrores.ts`.
- **Jest** en modo ESM (`node --experimental-vm-modules`), tests en `pruebas/` importando
  de `@jest/globals`. Transformador propio de ~10 líneas con
  `module.stripTypeScriptTypes` (lo mismo que hace Node al ejecutar). Si da problemas:
  `@swc/jest`. No se usa `ts-jest` porque depende de la API vieja del compilador y el
  proyecto está en TypeScript 7.
- `tsconfig.check.json` para que `npm run check` también tipe `pruebas/`.
- Tests del runner: orden de ejecución, corte en el primer error, log del filtro que falló.

### Sesión 2 — Pipeline de ingesta
- `src/pipeline/ingesta/`:
  - `filtroValidacion.ts` — esquema **Zod**; solo valida, no transforma. Acumula todos
    los errores en `detalles`. Reemplaza `validaciones/activoValidacion.ts`
    (`validarSimbolo` se conserva para `GET /precios/:simbolo`).
  - `filtroNormalizacion.ts` — símbolo en mayúsculas, espacios extra fuera.
  - `filtroConversionMoneda.ts` — campo nuevo opcional `moneda` (default `USD`); si es
    otra, consulta la tasa y convierte `precioCompra`.
- `src/servicios/tasasServicio.ts` — adaptador de tipo de cambio con el mismo molde que
  `preciosServicio.ts` (fetch nativo, `AbortSignal.timeout`, 502 si falla el tercero).
  API gratuita sin key (candidata: `open.er-api.com`, soporta UYU; se confirma al
  implementar). Variable nueva `API_TASAS_URL`.
- Los filtros se crean con sus dependencias por parámetro (`crearFiltroConversionMoneda({
  obtenerTasa })`) para testearlos sin red.
- `servicios/activosServicio.ts`: `crearActivo` y `actualizarActivo` pasan por el
  pipeline (mismo pipeline para POST y PUT) y quedan `async`.
- Tests unitarios de cada filtro + pipeline completo de ingesta.

### Sesión 3 — Pipeline de análisis y cierre de la Parte 3
- `src/pipeline/analisis/`: `filtroDepuracion.ts` (descarta montos ≤ 0),
  `filtroAnalisisRiesgo.ts` (marca `high_risk` si `cantidad × precioCompra` supera
  `UMBRAL_MONTO_USD` o si la `volatilidad` informada supera `UMBRAL_VOLATILIDAD`),
  `filtroFormato.ts` (redondeo a 2 decimales + metadatos de auditoría: fecha, filtros
  aplicados, id de análisis).
- `POST /api/activos/analizar` — recibe un array, responde 200 con
  `{ resumen: { recibidos, descartados, analizados, altoRiesgo }, activos }`.
  Servicio nuevo `servicios/analisisServicio.ts`; ruta y controlador en los archivos existentes.
- Tests de los tres filtros y del pipeline; requests nuevos en la colección de Postman.
- Docs: README (endpoints, pipeline, logging, tests), `RESPUESTAS-PARTE-3.md`, bitácora.
- `/code-review` sobre lo hecho en la Parte 3.

### Sesión 4 — Infraestructura de datos y migraciones
- `docker-compose.yml` con `mysql` y `mongodb` tomados del `compose.yaml` del ejemplo
  (imágenes fijadas, healthchecks, volúmenes, puertos solo en 127.0.0.1).
- `.env` / `.env.example`: `MYSQL_*` y `MONGO_*` como en el ejemplo, más `MYSQL_HOST` y
  `MONGO_HOST`. Un solo `.env` sirve a Compose y a la app.
- `config/env.ts`: valida las variables nuevas y arma la URI de Mongo
  (`authSource=admin`), como `config.ts` del ejemplo.
- Dependencias con las versiones del ejemplo: `sequelize` 6.37, `mysql2`, `mongoose` 9,
  más `umzug`.
- `src/datos/conexiones.ts` — crear/cerrar Sequelize y Mongoose (molde: `database.ts` del ejemplo).
- `src/datos/modelos/activoModelo.ts` — `sequelize.define`, tabla `activos`, columnas
  snake_case (`precio_compra`, `creado_en`, `actualizado_en`), `DECIMAL(24,8)` y
  `DECIMAL(20,2)`, `simbolo` único. `timestamps: false`: las fechas las sigue poniendo el servicio.
- `src/datos/migraciones/` — `001-crear-activos.ts` (`up`/`down`) + lista explícita de
  migraciones (imports estáticos, sin glob: funciona igual en `src/` y en `dist/`).
- `src/datos/migrar.ts` + scripts `npm run migrar` y `npm run migrar:deshacer`.
- Sin `sync()`: el esquema solo cambia por migraciones.

### Sesión 5 — Repositorio de activos sobre MySQL
- `datos/activosRepositorio.ts` reescrito con el modelo Sequelize: mismas funciones,
  ahora `async`. Mapea fila ↔ `Activo` (DECIMAL texto → `number`, `Date` → ISO) para que
  el contrato JSON no cambie. `UniqueConstraintError` → `ErrorApi(409)`.
- `activosServicio.ts` y `activosControlador.ts`: solo se agregan `await`/`async` en
  listar, obtener y eliminar. El filtro `?simbolo=` baja a un `WHERE`.
- `servidor.ts`: conectar MySQL → correr migraciones pendientes → conectar Mongo →
  `listen`; cierre ordenado de conexiones en `SIGTERM`/`SIGINT`.
- Verificar que los datos sobreviven a un reinicio de la API.
- **Redondeo de MySQL (hallado en la sesión 4):** `DECIMAL(20,2)` y `DECIMAL(24,8)` redondean
  en silencio (`98.456` se guarda como `98.46`). El repositorio tiene que devolver lo que
  quedó realmente guardado (releer la fila tras escribir) para que el POST y el GET siguiente
  digan lo mismo.

### Sesión 6 — Auditoría en MongoDB
- `src/datos/modelos/registroAuditoriaModelo.ts` — schema Mongoose como el del ejemplo:
  `operacion` (`CREAR | ACTUALIZAR | ELIMINAR`), `entidad`, `entidadId`, `antes` /
  `despues` / `metadatos` como `Mixed`, `ocurridoEn`, índice `{ entidadId, ocurridoEn: -1 }`.
- `src/datos/auditoriaRepositorio.ts` — `registrar()`, `historialDe(entidadId)`, `listar(filtros)`.
- `activosServicio.ts`: después de cada escritura en MySQL dispara el registro en Mongo
  (crear → `despues`; actualizar → `antes` y `despues`; eliminar → `antes`). La
  conversión de moneda del pipeline viaja en `metadatos`.
- Si Mongo falla después de que MySQL confirmó: se loguea el error y la request responde
  bien igual (la operación ya ocurrió). Se documenta el riesgo y Transactional Outbox
  como mejora, que es la discusión que plantea la guía del ejemplo.
- Endpoints de lectura: `GET /api/activos/:id/historial` (funciona aunque el activo ya
  esté borrado) y `GET /api/auditoria?operacion=`.

### Sesión 7 — API en Compose y cierre
- Servicio `api` en `docker-compose.yml`: build del `Dockerfile` existente,
  `env_file: .env`, `MYSQL_HOST=mysql` y `MONGO_HOST=mongodb`, `depends_on` con
  `condition: service_healthy`. `.dockerignore` suma `Contextos` y `pruebas`.
- Postman: requests de historial/auditoría, y un paso inicial de limpieza para que la
  colección se pueda correr dos veces seguidas (ahora los datos persisten).
- Docs: README (compose, variables, migraciones, modelo de datos),
  `RESPUESTAS-PARTE-4.md` (decisiones, MySQL vs Mongo, consistencia entre bases,
  dificultades), bitácora final.
- `/code-review` de la Parte 4 y `/security-review` (credenciales, compose).
- Mensaje final para el profesor.

## Documentación del trabajo en conjunto

`BITACORA.md`, una entrada por sesión con: fecha · objetivo · modelo y esfuerzo · modo
(plan / implementación) · skills y herramientas usadas · decisiones (quién eligió y por
qué) · qué se verificó y con qué resultado · pendientes.

Entrada de la sesión 0 (se escribe al empezar la sesión 1):
- 2026-10-05 · Planificación · Opus 5.5 · esfuerzo alto · modo plan (solo lectura).
- Exploración directa de código, letras y ejemplo, sin subagentes.
- Hallazgo: la Parte 3 no estaba implementada ni estaba la letra; la agregaste durante la sesión.
- Decisiones tuyas: Parte 3 antes que Parte 4, Umzug, sin `User`.
- Decisiones propuestas por Claude: Winston, Jest sin `ts-jest`, auditoría best-effort,
  Zod para reemplazar la validación manual, nombres en español en tablas y colecciones.
- Docker Desktop estaba apagado: hay que prenderlo desde la sesión 4.

Sugerencia de modelo por sesión (lo que se use de verdad queda en la bitácora):
Sonnet 5.5 · medio para las sesiones 2, 3, 5 y 6; Opus 5.5 · alto para la 1 y la 4
(configuración con riesgo: Jest + ESM + TS 7, Umzug) y para la 7 (integración y revisión).

Skills previstas: modo plan (esta sesión), `/init` para `CLAUDE.md`, `/code-review` al
cerrar cada parte, `/security-review` al final, `/simplify` si alguna sesión queda cargada.

## Riesgos conocidos

- **TypeScript 7** con los tipos de Sequelize 6, Mongoose 9 y Zod: se valida con
  `npm run check` apenas se instalan. Plan B: fijar TypeScript 5.9, como el ejemplo.
- **Jest + ESM** es experimental; el plan B es `@swc/jest`.
- **DECIMAL → number** en el repositorio pierde precisión extrema; se acepta para no
  cambiar el contrato JSON y se documenta.
- **Migraciones al arrancar**: cómodo con una sola instancia; con varias haría falta un
  paso separado. Se documenta.

## Verificación

Al cierre de cada sesión:
- `npm run check` y `npm test` en verde.
- `npm run dev` + colección de Postman completa (o los `curl` del README).

Parte 3:
- POST con `" btc "` devuelve `BTC`; POST con `moneda: "EUR"` guarda el precio en USD;
  body inválido devuelve 400 con todos los errores.
- `POST /api/activos/analizar` con un lote mixto: descarta los ≤ 0, marca `high_risk`,
  redondea.
- En consola aparece una línea por filtro y, ante un error, cuál falló.

Parte 4:
- `docker compose up -d --wait` → las tres piezas `healthy`.
- `docker compose exec mysql mysql ... -e "SELECT * FROM activos"` muestra lo creado por la API.
- `mongosh` / Compass: un documento por operación, con `antes`/`despues` en las actualizaciones.
- Reiniciar la API y comprobar que los activos siguen ahí.
- `npm run migrar:deshacer` + `npm run migrar` recrea la tabla.
- Bajar Mongo y crear un activo: responde 201 y queda el error en el log.

## Mensaje de encare para el profesor (borrador)

> Hola profe, le cuento cómo estoy encarando las partes 3 y 4 del ejercicio de la API cripto.
>
> Trabajo con Claude Code. Antes de escribir código hice una sesión solo de planificación
> (modelo Opus 5.5, esfuerzo alto, en modo plan, que es de solo lectura): le pasé las
> letras y el ejemplo de bases de datos, revisó el código que ya tenía y armamos un plan
> en 7 sesiones cortas. Las decisiones las fui tomando yo sobre opciones que me planteaba
> con sus pros y contras.
>
> Lo principal que definimos:
> - Hacer primero la Parte 3 (Pipes & Filters) y después la Parte 4, porque me faltaba la 3.
> - Parte 3: un runner de pipeline tipado, filtros como unidades independientes con sus
>   dependencias inyectadas para poder testearlos sin red, Zod para validar, Winston para
>   el logging y Jest para los tests.
> - Parte 4: MySQL con Sequelize para los activos y MongoDB con Mongoose para la
>   auditoría, siguiendo el ejemplo de clase. Migraciones con Umzug en vez de
>   sequelize-cli, porque el proyecto es ESM y corre TypeScript sin transpilar.
> - La entidad User opcional la dejé fuera: sin autenticación no aporta.
> - Si falla la escritura de auditoría en Mongo después de que MySQL confirmó, la API
>   responde bien y deja el error en el log. Lo dejo documentado como limitación.
>
> Voy llevando una bitácora en el repo con cada sesión: qué modelo y esfuerzo usé, qué
> decidimos y por qué, y qué se verificó. Cuando termine cada parte le mando el resumen.
