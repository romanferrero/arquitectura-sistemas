# Bitácora de trabajo

Registro de cómo se trabaja el ejercicio entre el estudiante y Claude Code: qué modelo y
esfuerzo se usó en cada sesión, qué se decidió, quién lo decidió y cómo se verificó.
El plan completo está en [PLAN.md](PLAN.md).

---

## Sesión 0 — Planificación · 2026-10-05

- **Modelo / esfuerzo:** Opus 5.5 · esfuerzo alto (dato que informó el estudiante).
- **Modo:** plan (solo lectura, sin tocar código).
- **Herramientas:** lectura directa de archivos, PDF de las letras y ejemplo; consulta de
  versiones de Node, TypeScript y Docker; preguntas de decisión al estudiante.
  No se usaron subagentes ni skills.
- **Qué se leyó:** código completo de `src/`, `README.md`, `RESPUESTAS.md`, `Dockerfile`,
  colección de Postman, letra de la Parte 4, letra de la Parte 3 y la carpeta
  `Contextos/crypto-databases-ejemplo` (compose, guías, modelos Sequelize y Mongoose).

**Hallazgos**
- La Parte 4 habla de adaptar un `AuditRepository` existente, pero ninguna letra lo define.
- La Parte 3 (Pipes & Filters, Zod, Winston/Pino, Jest) no estaba implementada y su letra
  no estaba en `Contextos/`; el estudiante la agregó durante la sesión.
- Docker Desktop estaba apagado (el cliente respondía, el servidor no).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Hacer la Parte 3 antes que la 4 | Estudiante | Respetar el orden del curso; la 3 no estaba hecha |
| Migraciones con Umzug | Estudiante, a propuesta de Claude | El proyecto es ESM y corre TS sin transpilar; sequelize-cli es CommonJS |
| Entidad `User` opcional fuera de alcance | Estudiante, a propuesta de Claude | Sin autenticación no hay forma real de asignar dueño |
| Auditoría como `AuditRepository` nuevo | Claude (supuesto) | No existe en ninguna letra anterior |
| Winston para logging | Claude | La letra permite Winston o Pino |
| Jest sin `ts-jest` | Claude | `ts-jest` depende de la API vieja del compilador; el proyecto usa TypeScript 7 |
| Si Mongo falla tras confirmar MySQL, la API responde bien y loguea | Claude (a validar en sesión 6) | La operación principal ya ocurrió |

---

## Sesión 1 — Base del pipeline, logger y tests · 2026-10-05

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (dato que informó el estudiante al
  cerrar la sesión). El plan sugería Opus 5.5 · alto para esta sesión, pero la
  implementación corrió en Sonnet 5.5 (cambio con `/model`).
- **Modo:** implementación.
- **Herramientas:** edición de archivos, `npm install`, ejecución de `tsc` y Jest, prueba
  manual de la API compilada. Sin skills ni subagentes.

**Qué se hizo**
- Documentación base: `PLAN.md` (con checklist de sesiones), `BITACORA.md`, `CLAUDE.md`
  con convenciones y comandos. Dos memorias de Claude: bitácora/mensaje al profesor y
  `Contextos/` como fuente de letras.
- [src/pipeline/pipeline.ts](src/pipeline/pipeline.ts): tipo `Filtro` y clase `Pipeline`.
  Inmutable (`agregar()` devuelve un pipeline nuevo), tipado de punta a punta (un orden
  inválido de filtros no compila), fail fast, y propaga el error original sin envolverlo
  para que un `ErrorApi` conserve su código HTTP. No importa nada del resto de la app.
- [src/config/logger.ts](src/config/logger.ts): Winston. Formato `[INFO] Origen: mensaje`
  en desarrollo, JSON en producción, silencioso con `NODE_ENV=test`. Reemplaza los
  `console.*` de `servidor.ts` y `manejadorErrores.ts`.
- Jest en modo ESM con un transformador propio de 3 líneas
  ([pruebas/transformadorTs.js](pruebas/transformadorTs.js)) que usa
  `module.stripTypeScriptTypes`, o sea lo mismo que hace Node al ejecutar los `.ts`.
- `tsconfig.check.json`: `npm run check` ahora tipa también `pruebas/`; el build sigue
  compilando solo `src/`.
- 8 tests del runner en [pruebas/pipeline/pipeline.test.ts](pruebas/pipeline/pipeline.test.ts):
  orden, cambio de tipo entre filtros, filtros asíncronos, fail fast, log del filtro que
  falló, registrador firmado por filtro e inmutabilidad.

**Decisiones**
- El runner recibe una *fábrica de registradores* por parámetro en vez de importar el
  logger. Así se testea sin Winston ni variables de entorno, y es el mismo criterio de
  inyección que van a usar los filtros de las sesiones 2 y 3. *(Claude, dentro de lo
  planeado.)*
- El transformador de Jest usa una API de Node marcada como experimental. Se acepta
  porque se usa solo para tests; si cambia, el plan B es `@swc/jest`. *(Claude.)*

**Control de versiones (GitFlow)**
- Remoto: `https://github.com/romanferrero/arquitectura-sistemas.git` (estaba vacío).
- La raíz del repo es `ejercicio2/` *(decisión del estudiante)*. `Contextos/` queda fuera
  del repo (`.gitignore`): son letras y ejemplos del profesor y se usan solo en local
  *(decisión de Claude, revertible quitando una línea de `.gitignore`)*.
- `main` es producción y solo recibe merges al cerrar una parte completa y chequeada;
  se trabaja en `develop` a través de ramas `feature/*`. *(Estudiante.)*
- Commit base en `main`: el proyecto tal como estaba antes de la Parte 3. Como ya había
  trabajo de esta sesión sin commitear, el baseline se armó en una copia temporal con los
  archivos de la sesión revertidos, de modo que el historial muestre el cambio real.
- Mensajes de commit breves y descriptivos, en español, **sin** `Co-Authored-By`
  *(preferencia del estudiante)*.
- `develop` se publica al cerrar cada sesión *(decisión del estudiante)*.

**Verificación**
- `npm run check`: sin errores.
- `npm test`: 1 suite, 8 tests en verde (Node muestra dos advertencias de
  "ExperimentalWarning", esperadas).
- `npm run build`: sin errores. La API compilada arranca, loguea con el formato nuevo,
  `/salud` responde 200 y una ruta inexistente responde 404.

**Pendientes / a tener en cuenta**
- **Resuelto** (rama `fix/dependencias-vulnerables`, aprobado por el estudiante):
  `npm audit` marcaba 2 vulnerabilidades en dependencias transitivas de Express,
  anteriores a esta sesión: `proxy-addr` (crítica, 2.0.7 → 2.0.8) y `qs` (moderada,
  6.15.3 → 6.16.0). Solo cambió `package-lock.json`. Verificado: `npm audit --omit=dev`
  da 0 vulnerabilidades; tipos, 8 tests, build y API (POST válido 201, JSON roto 400,
  `?simbolo=` 200) siguen bien.
- Quedan 19 avisos moderados **solo de desarrollo**, todos en la cadena de Jest
  (`js-yaml` dentro de las herramientas de cobertura). No llegan a producción y no se
  corrigen sin forzar una versión mayor de Jest; se dejan como están.
- La colección de Postman no se tocó (no cambió el contrato de la API).

---

## Sesión 2 — Pipeline de ingesta · 2026-10-06

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (confirmado por el estudiante al
  cerrar la Parte 3).
- **Modo:** implementación, en `feature/sesion-2-pipeline-ingesta`.
- **Herramientas:** edición de archivos, `npm install zod`, pruebas de la API real con
  `curl` (incluida la API de tipo de cambio), pruebas de mutación a mano. Sin skills ni
  subagentes.

**Qué se hizo**
- [src/pipeline/ingesta/](src/pipeline/ingesta/): tres filtros y el armado del pipeline.
  - `filtroValidacion`: esquema **Zod** (v4). Solo valida, no transforma: `" btc "` sale
    igual y lo limpia el filtro siguiente. Mantiene los mismos mensajes de error que la
    validación manual anterior y los devuelve todos juntos.
  - `filtroNormalizacion`: símbolo en mayúsculas y sin espacios, nombre sin espacios
    repetidos, moneda en mayúsculas (default USD).
  - `filtroConversionMoneda`: si la moneda no es USD, pide la tasa y convierte
    `precioCompra` a USD con dos decimales. Es una fábrica que recibe `obtenerTasa`.
  - `pipelineIngesta`: Validación → Normalización → Conversión. Recibe logger y tasa por
    parámetro, así los tests arman el pipeline real sin red.
- [src/servicios/tasasServicio.ts](src/servicios/tasasServicio.ts): adaptador de
  `open.er-api.com` con el mismo molde que `preciosServicio` (fetch nativo, timeout, 502 si
  falla el tercero). Variable nueva `API_TASAS_URL`.
- `crearActivo` y `actualizarActivo` pasan por el pipeline y quedaron `async`; el
  controlador solo sumó `async`/`await`. El orden de `actualizarActivo` se mantiene: primero
  404 si el id no existe, después el pipeline.
- `activoValidacion.ts` quedó solo con `validarSimbolo` (lo reutiliza el filtro de
  validación y `GET /api/precios/:simbolo`).
- Campo nuevo opcional `moneda` en POST y PUT. El activo guardado no lo lleva: el precio
  se guarda siempre en USD.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| API de tasas: `open.er-api.com` | Claude | Gratuita, sin API key, soporta UYU; se verificó la respuesta real antes de escribir el adaptador |
| Moneda inexistente → 400, API caída → 502 | Claude | Mismo criterio que precios: el error del cliente es 4xx, el del tercero es 502 |
| Hay que mirar el cuerpo de la respuesta de tasas | Hallazgo | Para un código inválido la API responde HTTP 200 con `result: "error"` |
| Precio convertido que redondea a 0 → 400 | Claude | Un activo con precio 0 no es válido; evita guardar basura con monedas de valor muy bajo |
| El pipeline devuelve también `conversion` (moneda original, precio original, tasa) | Claude | La sesión 6 la va a guardar en el registro de auditoría |
| El PUT pasa por el mismo pipeline que el POST | Claude (según el plan) | Mismas reglas de ingreso para crear y reemplazar |

**Hallazgo y corrección (código de la sesión 1)**
Una prueba de mutación (invertir el orden de dos filtros) mostró que el compilador **no**
lo rechazaba, contra lo que decía el comentario de `pipeline.ts`: `Filtro.ejecutar` estaba
declarado como método y TypeScript compara los métodos de forma bivariante. Se pasó a
propiedad con tipo función y se agregó un test con `@ts-expect-error`, que `npm run check`
verifica. Ahora el orden incorrecto falla al compilar.

**Verificación**
- `npm run check`: sin errores. `npm run build`: sin errores.
- `npm test`: 5 suites, 54 tests en verde (53 de ingesta y runner + 1 de tipos).
- Mutaciones: sin `toUpperCase` → 6 tests fallan; orden invertido → falla el compilador.
- API real con `curl`: USD con texto sucio → 201 normalizado; EUR → 201 convertido con la
  tasa real; moneda `XXX` → 400; body inválido → 400 con los 4 errores; símbolo repetido →
  409; JSON roto → 400; PUT con UYU → 200 convertido; PUT de id inexistente → 404; DELETE →
  204. Con la API de tasas apagada: EUR → 502 y USD → 201 (no la necesita).
- Los logs salen una línea por filtro y, ante un error, cuál falló.

**Pendientes / a tener en cuenta**
- `tasasServicio` no tiene test unitario: importa `config/env.ts`, que corta el proceso si
  faltan variables. Se verificó a mano contra la API real y con la API caída. Queda como
  mejora si se separa la configuración.
- Requests de Postman para `moneda`: van en la sesión 3 junto con los del análisis.
- Documentación completa del pipeline (estructura, logging, tests): sesión 3.

---

## Sesión 3 — Pipeline de análisis y cierre de la Parte 3 · 2026-10-06

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (confirmado por el estudiante al
  cerrar la Parte 3).
- **Modo:** implementación, en `feature/sesion-3-pipeline-analisis`.
- **Herramientas:** edición de archivos, pruebas de la API con `curl`, pruebas de mutación
  a mano y **Newman** (vía `npx`, sin instalarlo en el proyecto) para correr la colección de
  Postman. Sin skills ni subagentes hasta aquí; el `/code-review` va a continuación.

**Qué se hizo**
- [src/pipeline/analisis/](src/pipeline/analisis/): `FiltroDepuracion`,
  `FiltroAnalisisRiesgo`, `FiltroFormato` y `pipelineAnalisis`. A diferencia de la ingesta,
  cada filtro trabaja sobre el **lote** completo.
- `POST /api/activos/analizar` con `analisisServicio`; recibe un array y no guarda nada.
  La respuesta lleva `auditoria`, `resumen` y `activos`.
- Variables nuevas `UMBRAL_MONTO_USD` (100000) y `UMBRAL_VOLATILIDAD` (80).
- `src/utilidades/redondear.ts`: la función estaba duplicada en dos archivos y el filtro de
  formato era el tercero; se unificó.
- Postman: 5 requests nuevos (conversión de moneda y análisis), agregados solo con líneas
  nuevas en el diff.
- Documentación: README (pipelines, logging, tests, estructura, decisiones, endpoints) y
  `RESPUESTAS-PARTE-3.md`. Se corrigieron dos afirmaciones del README que dejaron de ser
  ciertas ("sin librería de validación" y "tests automatizados" como mejora pendiente).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| El análisis **descarta** elementos inválidos en vez de rechazar el lote | Claude | La letra dice que el ScrubbingFilter "filtra"; un elemento malo no debe invalidar a los demás. Cada descarte queda en el log |
| `high_risk` si el monto **supera** el umbral (estricto) o si la volatilidad lo supera | Claude | La letra dice "supera el umbral". Los motivos (`whale_alert`, `alta_volatilidad`) se informan por separado |
| La volatilidad es un dato opcional que informa el cliente, en % | Claude | La letra no define de dónde sale; no hay datos históricos en la app |
| Los umbrales son variables de entorno | Claude | Mismo criterio que el resto de la configuración (fail fast) |
| **La `cantidad` no se redondea** | Claude, **a validar** | La letra dice "valores numéricos", pero a dos decimales `0.00345` BTC pasaría a ser `0`. Revertirlo es una línea en `filtroFormato.ts` |
| Los metadatos de auditoría van a nivel respuesta (`idAnalisis`, fecha, filtros aplicados) | Claude | Es información del análisis completo, no de cada activo |
| El símbolo se pasa a mayúsculas en la depuración | Claude | Consistencia con el resto de la API; se vio al probar con `"btc"` |
| Rutas en español (`/api/activos/analizar`) en vez de `/assets/analyze` | Claude | Se mantiene la convención del proyecto |
| Un solo `redondear` compartido | Claude | Estaba duplicado en dos archivos |

**Verificación**
- `npm run check`: sin errores. `npm run build`: sin errores.
- `npm test`: 9 suites, 105 tests en verde.
- Mutaciones (5): `>=` en lugar de `>` en monto, ídem en volatilidad, sin chequear
  `cantidad <= 0`, sin redondear `precioCompra` y redondeando `cantidad`. Los 5 fueron
  detectadas por los tests.
- **Newman sobre la colección completa: 22 requests, 44 aserciones, 0 fallas.** Los 17
  originales siguen pasando, o sea que el contrato de la API no cambió.
- `curl`: lote mixto → 200 con 3 descartes y 2 `high_risk`; body que no es array → 400; array
  vacío → 200 con resumen en cero; JSON roto → 400; `GET /analizar` → 404; el análisis no
  agrega nada al portafolio.

**Pendientes / a tener en cuenta**
- Cierre de la Parte 3: `/code-review` sobre lo hecho y, con el OK del estudiante, merge de
  `develop` a `main`. *(Hecho: ver la entrada de cierre al final.)*
- `tasasServicio` y `preciosServicio` siguen sin test unitario (importan `config/env.ts`).

---

## Cierre de la Parte 3 — Revisión de código · 2026-10-06

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (confirmado por el estudiante).
- **Modo:** revisión y correcciones, en `fix/revision-parte-3`.
- **Skill usada:** `/code-review` en nivel *high*, sobre todo lo que `develop` tenía de más
  que `main` (las sesiones 1 a 3 completas). Se ejecutó en un subproceso y devolvió 8
  hallazgos, que se evaluaron uno por uno.

**Hallazgos y decisión**

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | `respuesta.json()` fuera de `try`: una respuesta no-JSON de la API de tasas daba 500 en vez de 502 | **Corregido** en `tasasServicio` y también en `preciosServicio`, que tenía el mismo código desde antes de la Parte 3 |
| 2 | `logger.error("…", { error })` perdía el mensaje y el stack (Winston no serializa un `Error`) | **Corregido.** Era una regresión mía de la sesión 1 |
| 3 | `actualizarActivo` leía el activo antes del `await`: un DELETE concurrente dejaba al PUT responder 200 sobre algo que no se guardó | **Corregido**: se vuelve a leer después del pipeline (da 404 si se borró) |
| 4 | Sin caché de tasas, y la consulta ocurre antes de comprobar el 409 | **No se corrige.** Ya figuraba como mejora; se agregó al README |
| 5 | `volatilidad: null` descartaba el activo entero | **Corregido**: `null` cuenta como "no informada" |
| 6 | El análisis no validaba el símbolo ni el largo del nombre como la ingesta | **Corregido**: reutiliza `validarSimbolo` y el límite de 50 caracteres |
| 7 | `cantidad × precioCompra` podía desbordar a `Infinity` y salir como `null` en el JSON | **Corregido**: se descarta el activo |
| 8 | Los umbrales de riesgo no admitían 0 | **Corregido**: admiten 0; los negativos siguen abortando el arranque |
| 9 | Los fallos de validación (4xx) se loguean como `[ERROR]` | **No se corrige.** La letra pide registrar qué filtro falló; quedó como mejora en el README y en `RESPUESTAS-PARTE-3.md` |

**Verificación**
- Tests: 110 en verde (5 nuevos para las reglas de la depuración).
- Reproducido a mano antes de dar por cerrados los que no tienen test unitario, con un
  servidor falso de tasas: respuesta HTML → 502; `PUT` lento + `DELETE` → el PUT responde 404;
  umbral en 0 → arranca y marca `high_risk`; umbral negativo → aborta; error inesperado →
  el log trae mensaje y stack, tanto en formato de desarrollo como en JSON de producción.

**Pendiente**
- *(Hecho: ver la entrada de cierre al final.)*

---

## Parte 3 en `main` · 2026-10-06

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Qué se hizo:** merge de `develop` a `main` con `--no-ff` y push, con el OK del
  estudiante. Se agregó como regla del repo (en `CLAUDE.md` y en la memoria de Claude) que
  **no se usan tags**: el estudiante consideró que no hacían falta, así que el plan de
  etiquetar `parte-3` y `parte-4` se descartó.
- **Estado de la verificación al cerrar:** `npm run check` sin errores, 110 tests en verde y
  Newman sobre la colección de Postman con 22 requests y 44 aserciones sin fallas.
- **Siguiente:** sesión 4 (infraestructura de datos y migraciones), en una rama
  `feature/sesion-4-*` desde `develop`. Docker Desktop estaba apagado en la planificación:
  hay que prenderlo antes de empezar.

---

## Sesión 4 — Infraestructura de datos y migraciones · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el confirmado por el estudiante).
- **Modo:** implementación, en `feature/sesion-4-infraestructura-datos`.
- **Herramientas:** edición de archivos, Docker Compose (Claude lanzó Docker Desktop, que
  estaba apagado), el cliente `mysql` dentro del contenedor para probar las restricciones, y
  scripts descartables en el scratchpad. Sin skills ni subagentes.

**Qué se hizo**
- [docker-compose.yml](docker-compose.yml): MySQL 8.4 y MongoDB 8.0 tomados del ejemplo de
  `Contextos/` (versiones fijadas, healthchecks, volúmenes, puertos solo en 127.0.0.1).
- `.env` y `.env.example`: variables de ambas bases; el mismo archivo lo leen Compose y la app.
- `config/env.ts`: valida las variables nuevas (fail fast) y arma la URI de Mongo
  (`authSource=admin`, `directConnection=true`, usuario y password codificados).
- [src/datos/conexiones.ts](src/datos/conexiones.ts): Sequelize y Mongoose.
- [src/datos/modelos/activoModelo.ts](src/datos/modelos/activoModelo.ts): modelo de `activos`,
  con `precioCompra` mapeado a `precio_compra`.
- [src/datos/migraciones/](src/datos/migraciones/): `001-crear-activos` (tabla, símbolo único y
  dos `CHECK` de valores positivos) y la lista explícita; ejecutor con **Umzug** y comando.
- Scripts `migrar`, `migrar:deshacer`, `migrar:estado` y `db:verificar`.
- README: sección "Bases de datos", variables, comandos y estructura.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| El contenedor de Mongo sale por el puerto **27018** en el `.env` local | Claude | Hay un MongoDB de Windows (servicio `MongoDB`) corriendo en 27017; no se lo toca porque puede ser de otro proyecto. `.env.example` conserva 27017 |
| Comentarios del `.env` en línea aparte, no al final de la línea | Claude | Node y Compose los interpretan distinto según la versión |
| `name: portafolio-cripto` en el compose | Claude | Volúmenes y contenedores con nombre propio y no el de la carpeta |
| Migración autocontenida: no importa el modelo | Claude | Una migración describe el esquema de su momento; el modelo cambia después |
| `CHECK` por SQL directo | Claude | Es la forma explícita en MySQL 8 y el error de la base es claro |
| Longitudes `simbolo` 10 y `nombre` 50 (el ejemplo usaba 15 y 100) | Claude | Coinciden con las reglas de validación de la API |
| `DECIMAL(24,8)` y `DECIMAL(20,2)`, collation `utf8mb4_0900_ai_ci` | Del ejemplo | Dinero sin `FLOAT`; el símbolo único no distingue mayúsculas |
| Se agregaron `migrar:estado` y `db:verificar` (no estaban en el plan) | Claude | Permiten probar Mongo antes de la sesión 6 y distinguir "no llega a la base" de "bug de la app" |
| Helper `describirError` | Claude | Los errores de conexión de Sequelize llegan con `message` vacío (se vio al probar con el puerto equivocado) |
| `umzug` y `sequelize` con avisos de `npm audit` | Claude, **a validar** | Ver pendientes |

**Verificación**
- `npm run check` sin errores; `npm test`: 11 suites, 120 tests en verde (15 nuevos: lista de
  migraciones, migración 001 contra un `QueryInterface` falso y `describirError`).
- Mutación: cambiar `> 0` por `>= 0` en un `CHECK` → un test falla.
- `docker compose up -d --wait`: MySQL y MongoDB `healthy`. `db:verificar`: MySQL 8.4.11 y
  MongoDB responden.
- `migrar` crea `activos` y `migraciones`; repetirlo dice "no hay pendientes";
  `migrar:deshacer` borra la tabla; `migrar` la recrea. También funciona desde `dist/`.
- **MySQL hace cumplir las reglas**, probado con inserts a mano: símbolo duplicado (incluso en
  minúscula) → error 1062; cantidad 0 → error 3819; precio negativo → error 3819.
- El modelo de Sequelize crea y lee filas: DECIMAL como texto, fechas como `Date`, mapeo de
  `precio_compra` a `precioCompra`.
- Caminos de error: MySQL en un puerto equivocado → `SequelizeConnectionRefusedError:
  ECONNREFUSED`, exit 1; la app contra el MongoDB de Windows → "Authentication failed"; falta
  una variable → corta el arranque nombrándola.

**Hallazgos y pendientes**
- **Redondeo silencioso de MySQL:** `precioCompra: 98.456` se guardó como `98.46`. Si el
  repositorio devolviera lo que recibió, el POST diría 98.456 y el GET siguiente 98.46.
  Se resuelve en la sesión 5 (releer la fila tras escribir); quedó anotado en `PLAN.md`.
- **`npm audit --omit=dev` pasó de 0 a 6 avisos moderados**, todos transitivos: `umzug` →
  `@rushstack/ts-command-line` → `sprintf-js` (solo afecta su herramienta de línea de comandos,
  que no usamos) y `sequelize` 6 → `uuid` < 11 (el aviso es sobre un parámetro `buf` que
  Sequelize no usa). Los arreglos que propone npm instalan versiones de hace años, así que no se
  aplicaron. Sequelize 6.37.8 es la misma versión que fija el ejemplo del profesor.
- El `.env.example` trae credenciales de desarrollo local tomadas del ejemplo; no deben usarse
  fuera de la máquina local.
- Los contenedores quedan corriendo al cerrar la sesión (`docker compose stop` para
  detenerlos; los datos se conservan).
- La imagen de la API todavía no se conecta a las bases: eso llega con la sesión 5 y el
  servicio `api` del compose en la sesión 7.
