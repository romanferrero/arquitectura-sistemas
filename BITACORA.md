# Bitácora de trabajo

Registro de cómo se trabaja el ejercicio entre el estudiante y Claude Code: qué modelo y
esfuerzo se usó en cada sesión, qué se decidió, quién lo decidió y cómo se verificó.
El plan vigente (Partes 5 a 8) está en [PLAN.md](PLAN.md); el de las Partes 3 y 4, ya terminado, en
[PLAN-PARTES-3-4.md](PLAN-PARTES-3-4.md).

## Resumen: skills y herramientas usadas

Las skills son paquetes de instrucciones de Claude Code que se invocan con `/nombre`. Se usaron siete veces,
siempre al **cerrar una parte**, y la lista se mantiene al día (regla en `CLAUDE.md`).

| Skill | Cuándo | Para qué | Resultado |
|---|---|---|---|
| `/code-review` (nivel *high*) | Cierre de la Parte 3 | Revisar lo que `develop` tenía de más que `main` | 9 hallazgos: 7 corregidos y 2 documentados |
| `/code-review` (nivel *high*) | Cierre de la Parte 4 | Ídem, sobre las sesiones 4 a 7 | 10 hallazgos: 7 corregidos y 3 documentados |
| `/security-review` | Cierre de la Parte 4 | Buscar vulnerabilidades en los cambios | Sin vulnerabilidades de alta confianza |
| `/code-review` (nivel *high*) | Cierre de la Parte 5 | Ídem, sobre las sesiones 9 y 10 (Redis, BullMQ y el worker) | 9 hallazgos: 6 corregidos y 3 documentados |
| `/code-review` (nivel *high*) | Cierre de la Parte 6 | Ídem, sobre las sesiones 11 y 12 (autenticación, roles y modo pánico) | 10 hallazgos: 6 corregidos y 4 documentados |
| `/security-review` | Cierre de la Parte 6 | Buscar vulnerabilidades en la autenticación y la autorización | Sin vulnerabilidades de alta confianza |
| `/code-review` (nivel *high*) | Cierre de la Parte 7 | Ídem, sobre las sesiones 13 y 14 (CQRS, eventos y suscriptores) | 10 hallazgos: 5 corregidos y 5 documentados |

Las siete corren en un subproceso aparte (no comparten el contexto de la sesión). En el resto de las sesiones no se
usó ninguna skill.

Otras herramientas, que no son skills: **modo plan** de Claude Code (solo la sesión 0), **Newman** vía `npx` para
correr la colección de Postman, **Docker Compose**, **Jest** y pruebas de mutación hechas a mano.

Los modelos usados: Opus 5.5 en la planificación (sesiones 0 y 8) y Sonnet 5.5 en la implementación (sesiones 1 a 7, 9 a 14 y
las revisiones). Esfuerzo alto en todo, salvo la sesión 8 (planificación de las Partes 5 a 8), que fue extra alto.

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
  que `main` (las sesiones 1 a 3 completas). Se ejecutó en un subproceso y devolvió 9
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

---

## Sesión 5 — Repositorio de activos sobre MySQL · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el confirmado por el estudiante).
- **Modo:** implementación, en `feature/sesion-5-repositorio-mysql`.
- **Herramientas:** edición de archivos, Docker (bases e imagen), Newman, `curl`, scripts
  descartables. Sin skills ni subagentes.

**Qué se hizo**
- [src/datos/activosRepositorio.ts](src/datos/activosRepositorio.ts) reescrito sobre Sequelize: mismas
  funciones, ahora asíncronas. El filtro `?simbolo=` es un `WHERE`. Todo lo que devuelve está
  **releído de la base** tras escribir.
- [src/datos/mapeoActivo.ts](src/datos/mapeoActivo.ts): fila ↔ `Activo` en funciones puras.
- Servicio y controlador: solo `async`/`await`, más lo que cambia por la base (ver decisiones).
- [src/servidor.ts](src/servidor.ts): conecta MySQL → migra → conecta Mongo → escucha; si algo falla no
  levanta. Cierre ordenado con SIGTERM/SIGINT.
- [src/modelos/limites.ts](src/modelos/limites.ts): rangos que entran en las columnas, aplicados en la
  validación y en la conversión de moneda.
- Postman: request `00 - Limpiar el portafolio` (los datos ahora persisten).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| El símbolo único lo hace cumplir la restricción `UNIQUE`; se quitó la búsqueda previa | Claude | "Buscar y después guardar" no es seguro con una base real: 5 `POST` simultáneos del mismo símbolo → 1 da 201 y 4 dan 409 |
| El repositorio lanza `SimboloDuplicadoError` (no `ErrorApi`); el servicio lo traduce a 409 | Claude, **cambia el plan** | El repositorio no conoce HTTP; el plan decía que lanzara `ErrorApi` directo |
| Releer la fila tras escribir | Claude (según el plan) | MySQL redondea los `DECIMAL`: `98.456` se guarda `98.46` y el POST tiene que decir lo mismo que el GET |
| Rangos numéricos validados (cantidad 1e-8…1e15, precio 0.01…1e15) | Claude | `cantidad: 1e-9` se redondea a 0, viola el `CHECK` y daba 500 |
| `actualizarActivo` relee el activo tras el pipeline y trata `reemplazar` → `undefined` como 404 | Claude | Sigue cubriendo el borrado concurrente (ahora con base real) |
| El request de limpieza de Postman se adelantó de la sesión 7 a esta | Claude | Sin él la colección no se puede correr dos veces |
| Se fijaron `@emnapi/core` y `@emnapi/runtime` como devDependencies | Claude | Ver hallazgo del build de Docker |

**Hallazgo: la imagen de Docker no se podía construir.** `npm ci` fallaba con "Missing:
@emnapi/core from lock file": Jest arrastra un binario WASM opcional (`unrs-resolver`) que npm en
Windows no registra en el lock. Es un problema que ya existía desde la sesión 1 (Jest) y no se había
visto porque nunca se había construido la imagen después. Se arregló fijando esas dos dependencias; `npm
ci` limpio pasa y `docker build` termina bien.

**Verificación**
- `npm run check` sin errores; `npm test`: 12 suites, 131 tests en verde (11 nuevos: mapeo y límites).
- Persistencia: un activo creado sigue ahí tras reiniciar la API; también está en MySQL (`SELECT`).
- Consistencia: `POST` con `precioCompra: 98.456` y `cantidad: 0.123456789` responde `98.46` y
  `0.12345679`, igual que el `GET` siguiente y que la fila.
- Newman **dos corridas seguidas**: 0 fallas, 45 aserciones (la limpieza funciona).
- Casos solo posibles con base real: carrera de 5 `POST` (1×201, 4×409); límites → 400 y nunca 500; `PUT`
  con símbolo ajeno → 409, `PUT` conserva `creadoEn`; 0 errores no controlados en el log.
- Arranque con MongoDB caído → "MongooseServerSelectionError" y exit 1 (tarda ~12 s); con MySQL caído →
  "SequelizeConnectionRefusedError: ECONNREFUSED" y exit 1.
- **Imagen de Docker en Linux**: contra las bases del host, conecta, migra, responde y `docker stop`
  (SIGTERM real) la cierra en 1 s con código 0. Con el `.env` local falla con `ECONNREFUSED`, como se esperaba.

**Pendientes / a tener en cuenta**
- En Windows `kill -INT` no entrega la señal; el cierre se verificó disparando el evento dentro del proceso
  y, ya con señal real, en el contenedor.
- El servicio `api` dentro del compose (con `MYSQL_HOST=mysql`) queda para la sesión 7.
- Un fallo de Mongo al arrancar corta la API; en la sesión 6 una caída en *ejecución* no debe cortar las
  operaciones.

---

## Sesión 6 — Auditoría en MongoDB · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el confirmado por el estudiante).
- **Modo:** implementación, en `feature/sesion-6-auditoria-mongo`.
- **Contexto:** la computadora se apagó entre la sesión 5 y esta; se comprobó que el repo, la rama
  `develop` publicada y los contenedores estaban intactos antes de seguir.
- **Herramientas:** edición de archivos, `mongosh` dentro del contenedor, Newman, `curl`,
  pruebas de mutación a mano. Sin skills ni subagentes.

**Qué se hizo**
- [src/datos/modelos/registroAuditoriaModelo.ts](src/datos/modelos/registroAuditoriaModelo.ts): schema
  Mongoose (como el del ejemplo): operación `CREAR | ACTUALIZAR | ELIMINAR`, `antes`/`despues`/`metadatos`
  como `Mixed`, tres índices para las tres consultas que tiene.
- [src/datos/auditoriaRepositorio.ts](src/datos/auditoriaRepositorio.ts): `registrar`, `historialDe`, `listar`;
  solo alta y consulta. [mapeoAuditoria.ts](src/datos/mapeoAuditoria.ts): documento → registro, función pura.
- [src/servicios/crearServicioAuditoria.ts](src/servicios/crearServicioAuditoria.ts): fábrica con el repositorio,
  el logger y el tiempo máximo por parámetro; cableada en `auditoriaServicio.ts`.
- `activosServicio`: crear → `CREAR` (con la conversión de moneda en `metadatos`); actualizar → `ACTUALIZAR`
  (antes, después y `camposModificados`); eliminar → `ELIMINAR` (se lee el activo antes de borrar).
- Endpoints `GET /api/activos/:id/historial` y `GET /api/auditoria` (`?operacion=`, `?limite=`).
- Postman: 4 requests nuevos. README: sección de auditoría, endpoints, estructura y decisiones.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| La auditoría es de **mejor esfuerzo**: si falla, la operación responde bien y el error va al log | Claude, propuesto en el plan | MySQL ya confirmó, no hay transacción entre las dos bases y fallarle al cliente por el historial es peor que perder una línea |
| Tiempo máximo de **2 s** para registrar | Claude | Con Mongo caído el driver tarda 5 s en rendirse en *cada* escritura |
| Las consultas con Mongo caído dan **503**, no 500 | Claude | Es un servicio del que depende, no un bug de la API |
| Historial de un id desconocido → 404; de uno eliminado → 200 | Claude | Es justo lo que el historial tiene que poder responder |
| Operaciones en español (`CREAR`, `ACTUALIZAR`, `ELIMINAR`) | Claude | Convención del proyecto; el ejemplo las tenía en inglés |
| Se agregaron `camposModificados` y `metadatos.origen` | Claude | El ejemplo del profesor guardaba `changedFields` y `metadata.source` |
| Se leen `limite` (1–200, 50 por defecto) y `operacion` | Claude | Evitar devolver una colección que "puede crecer exponencialmente" entera |
| Tres índices en vez de uno | Claude | Uno por consulta: por activo, general y filtrada por operación |

**Verificación**
- `npm run check` sin errores; `npm test`: 15 suites, 158 tests en verde (27 nuevos).
- Mutaciones (3): no loguear el fallo de `registrar`, límite máximo 201 y sacar el tope de tiempo → las 3 detectadas.
- Ciclo real contra MongoDB: crear en EUR → actualizar → eliminar. El historial trae los 3 registros en
  orden, con la conversión (tasa 1.125), antes y después, y campos modificados; también están en Mongo
  (`mongosh`) con sus 4 índices.
- **MongoDB apagado con la API corriendo:** `POST` → 201 en 2,1 s y el activo queda en MySQL; el error
  queda en el log; `GET` del historial → 503; `GET /activos` (MySQL) → 200. Al volver Mongo, la API se
  reconectó sola y el siguiente `POST` se registró.
- Newman, dos corridas seguidas: 27 requests, 56 aserciones, 0 fallas.

**Pendientes / a tener en cuenta**
- Mientras Mongo está caído, cada escritura demora hasta 2 s y queda sin registro (decisión asumida).
- Un id mal escrito en `GET /api/activos/:id/historial` da 404 igual que uno inexistente.
- El tema de consistencia entre las dos bases va a la respuesta de la Parte 4 (sesión 7).

---

## Sesión 7 — API en Compose y cierre de la Parte 4 · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el confirmado por el estudiante).
- **Modo:** implementación, en `feature/sesion-7-api-en-compose`.
- **Herramientas:** Docker Compose, Newman, `curl`. Las revisiones (`/code-review`, `/security-review`)
  se registran en la entrada siguiente.

**Qué se hizo**
- Servicio `api` en [docker-compose.yml](docker-compose.yml): build del `Dockerfile`, `env_file: .env` y las
  variables que cambian dentro de la red de Docker (`MYSQL_HOST=mysql`, `MONGO_HOST=mongodb`, puertos
  internos), `depends_on` con `service_healthy`, healthcheck propio contra `/salud`.
- `.dockerignore`: se suman `Contextos`, `pruebas` y las configuraciones de desarrollo.
- README: sección Docker reescrita. `RESPUESTAS-PARTE-4.md`.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| La API también se publica solo en `127.0.0.1` | Claude | Salió en `0.0.0.0` (toda la red) y no tiene autenticación; las bases ya iban a local |
| El healthcheck de MySQL pasó a `-h 127.0.0.1` | Claude | Ver hallazgo |
| `NODE_ENV` queda como lo trae el `.env` (development) | Claude | Logs legibles para el curso; en producción real saldría JSON |
| El mismo `.env` sirve para local y para el compose, que pisa lo que cambia | Claude | Un solo archivo de configuración |

**Hallazgo: arrancar desde cero fallaba la primera vez.** Con un volumen nuevo, MySQL arranca un
servidor temporal solo por socket y el healthcheck del ejemplo (`mysqladmin ping -h localhost`) le
contestaba "sano". La API se conectaba antes de tiempo, salía con error, y la política `restart` la
levantaba de nuevo: terminaba funcionando, pero `--wait` informaba `unhealthy`. Se corrigió probando por
TCP. El mismo defecto está en el compose del ejemplo del profesor.

**Verificación**
- Los tres servicios `healthy` con un solo comando (`docker compose up -d --build --wait`).
- **Newman contra la API dentro del contenedor**, dos corridas seguidas: 29 requests, 56 aserciones, 0 fallas.
- `docker compose down` (sin `-v`) y volver a levantar: el activo y su historial siguen.
- `docker compose stop api` (SIGTERM real): cierra en 1 s con código 0.
- **Desde cero** (`down -v` + un comando), tres veces seguidas: 23–34 s, `healthy`, **0 reinicios** de la
  API; las migraciones se aplican solas y el `POST` registra su auditoría.

**Pendientes**
- `/code-review` y `/security-review` de la Parte 4 y, con el OK del estudiante, merge a `main`.

---

## Revisión de código de la Parte 4 · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Skill usada:** `/code-review` en nivel *high* sobre lo que `develop` tenía de más que `main` (sesiones 4 a 7).
  Devolvió 10 hallazgos; se evaluaron uno por uno, en `fix/revision-parte-4`.

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | El healthcheck de Mongo no se autentica: el `mongod` temporal de la inicialización (sin auth) respondería "sano" | **Corregido.** Es el mismo defecto que ya se había arreglado en MySQL. Un cliente anónimo recibe `Unauthorized`, o sea que el ping anónimo no probaba nada |
| 2 | `PUT` lee-modifica-escribe sin transacción: el `antes` auditado puede no ser lo que se reemplazó | **Corregido:** transacción con `SELECT ... FOR UPDATE`; el repositorio devuelve el `antes` real |
| 3 | `registrar` espera hasta 2 s a Mongo dentro de la petición | **No se corrige.** Es el compromiso elegido y documentado: esperar da orden y una garantía mayor de registro; fire-and-forget evitaría la demora pero perdería registros sin que nadie lo note |
| 4 | El historial da 404 o `[]` según lo que haya en cada base | **No se corrige.** Es inherente al mejor esfuerzo: si la auditoría se perdió, el historial de ese activo queda incompleto |
| 5 | El cierre ordenado no es idempotente | **Corregido** (bandera `cerrando`) |
| 6 | `buscarPorSimbolo` quedó sin uso | **Corregido** (se borró) |
| 7 | `MONGO_URI` se arma al importar `env`: `migrar` exigía variables de Mongo | **Corregido:** pasó a una función `mongoUri()` que el servidor llama al arrancar |
| 8 | El logger de Umzug mapeaba `warn` a `info` y podía imprimir `undefined` | **Corregido** |
| 9 | Los rangos numéricos están repartidos en migración, `limites.ts` y el filtro; un error de base da 500 | **No se corrige.** Ya validado y documentado; la duplicación es el precio de rechazar con 400 antes de llegar a la base |
| 10 | `?limite=1&limite=2` se ignoraba en silencio | **Corregido:** da 400 |

**Verificación:** 158 tests y `check` en verde; tres arranques desde cero con el healthcheck de Mongo nuevo
(0 reinicios de la API); 6 `PUT` simultáneos con una cadena de auditoría consistente; `migrar:estado` sin
ninguna variable de Mongo; parámetros repetidos → 400; tres señales seguidas → un solo cierre.

---

## Revisión de seguridad de la Parte 4 · 2026-10-07

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Skill usada:** `/security-review` sobre lo que `develop` tenía de más que `main`. Para que pudiera calcular el
  diff se apuntó `origin/HEAD` a `main` (es solo una referencia local; no toca el remoto).
- **Resultado: sin vulnerabilidades de alta confianza.** El informe vino en inglés porque la consigna de la skill lo
  estaba y pedía devolver solo el informe; el estudiante lo notó y se pasó a español.

**Qué se revisó y por qué no hay problema**
- **Inyección SQL:** todo pasa por Sequelize, que parametriza; las sentencias `ALTER TABLE` de la migración son constantes.
- **Inyección NoSQL:** `entidadId` viene de un parámetro de ruta (siempre texto), `operacion` se valida contra una lista
  cerrada y `limite` contra `^d+$` y un rango. Los parámetros repetidos se rechazan con 400 y no llegan a Mongo como arrays.
- **Contenido guardado en la auditoría:** solo activos ya validados por Zod y metadatos armados por el servidor.
- **Exposición de información:** el error no controlado responde un mensaje genérico; el stack va solo al log. No se loguean
  la URI de Mongo ni las contraseñas.
- **Red e imagen:** las tres piezas publican solo en `127.0.0.1`; el healthcheck usa `$$VAR` (no deja credenciales literales
  en `docker inspect`); `.env` queda fuera de la imagen y el contenedor corre sin privilegios.

**Fuera del alcance de esa revisión** (anotado como mejora en `RESPUESTAS-PARTE-4.md`): la API no tiene autenticación (ya
era así y afecta a todos los endpoints) y la aplicación se conecta a MongoDB con el usuario root.

---

## Sesión 8 — Planificación de las Partes 5 a 8 · 2026-10-30

- **Modelo / esfuerzo:** Opus 5.5 · esfuerzo **extra alto** (lo indicó el estudiante al pedir el plan).
- **Modo:** plan (solo lectura). Al aprobarse el plan, el cierre documental (este archivo, `PLAN.md`, `CLAUDE.md`) se
  hizo ya fuera del modo plan, en `feature/sesion-8-plan-partes-5-8`.
- **Herramientas:** lectura de las cuatro letras (PDF) y de los dos ejemplos nuevos, del código actual y de la
  bitácora; consultas de solo lectura (versiones de librerías en npm, puertos libres, núcleos y RAM, estado de Docker).
  Preguntas de decisión al estudiante. **Sin subagentes ni skills.**
- **Qué se leyó:** `Contextos/` con las Partes 5, 6, 7 y 8; `Ejemplo-pub-sub/` (API y dos suscriptores Redis en
  contenedores separados) y `pm2-lab/` (PM2 en cluster dentro de Docker y k6); y el código de `src/`, `docker-compose.yml`,
  `Dockerfile` y `package.json` tal como quedaron tras la Parte 4.

**Hallazgos**
- El PDF de la Parte 7 tiene el título "Parte 6": es un error de la letra, el contenido es CQRS y Pub/Sub.
- La letra de la Parte 6 dice "etapa final", pero después vienen la 7 y la 8.
- **Bull está en modo mantenimiento** (última versión en diciembre de 2024); sus autores recomiendan BullMQ.
- La máquina tiene 16 núcleos y 7,8 GB de RAM: `instances: "max"` crearía 16 procesos y puede no entrar en memoria.
- Docker Desktop estaba apagado.
- `PLAN.md` decía que faltaba el merge de la Parte 4 a `main`, pero ya estaba hecho.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Identidad con **Auth0** (opción B de la letra) | Estudiante | Es la recomendada y la primera de la lista. La API valida la firma con JWKS; los tests firman con claves propias, sin red |
| **BullMQ** en lugar de Bull | Estudiante, a propuesta de Claude | Bull ya no se desarrolla; los conceptos (cola, worker, `completed`/`failed`) son los mismos. Se documenta el cambio |
| Nombres en español, con tabla "letra → proyecto" en el README | Estudiante | Misma convención que en la Parte 3 (`/assets/analyze` → `/api/activos/analizar`) |
| Una parte por vez, cada una cerrada en `main` antes de empezar la siguiente | Estudiante | Mismo flujo que las Partes 3 y 4 |
| Worker y suscriptores como **procesos aparte** (misma imagen, otro comando) | Claude | Es el molde de los ejemplos y permite el cluster de la Parte 8 sin multiplicar el trabajo |
| Limpiar la caché con `SCAN` + `DEL` sobre `activo:*`, nunca `FLUSHALL` | Claude | `FLUSHALL` borraría jobs, preferencias y contadores |
| El modo pánico falla cerrado: si Redis no responde, se bloquean las escrituras | Claude | Ante la duda, no se escribe |
| Se hacen los tres bonus (contador atómico, modo pánico, Whale Alert y reto) | Claude, a confirmar | Cada uno entra en la parte que le corresponde |
| `GET /salud` se amplía en lugar de crear `/health` | Claude | Ya existe y lo usa el healthcheck de Docker |

**Resultado:** ocho sesiones nuevas (9 a 16), dos por parte; cada parte cierra con tests, `/code-review`, prueba manual,
merge a `main` y mensaje al profesor. Modelos sugeridos: Sonnet 5.5 para las sesiones 9, 10, 12, 13 y 16; Opus 5.5 para la 11
(seguridad y configuración externa), la 14 (consistencia asíncrona) y la 15 (cluster, señales y Docker).

**Pendientes**
- Antes de la sesión 9: prender Docker Desktop.
- Antes de la sesión 11: crear la cuenta de Auth0 (el paso a paso se guía en esa sesión). El profesor va a necesitar
  credenciales de prueba para ejercitar la API a mano.
- La memoria de Claude queda al día en `PLAN.md`; no se agregó nada nuevo.

---

## Sesión 9 — Redis: infraestructura, caché, preferencias y ranking · 2026-10-30

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (lo indicó el estudiante al empezar). El plan sugería Sonnet 5.5 para
  esta sesión.
- **Modo:** implementación, en `feature/sesion-9-redis-cache`.
- **Herramientas:** edición de archivos, `npm install redis`, Docker Compose, `redis-cli` dentro del contenedor, `curl`,
  Newman (vía `npx`) y pruebas de mutación a mano. Sin skills ni subagentes.

**Qué se hizo**
- [docker-compose.yml](docker-compose.yml): servicio `redis` (7.4-alpine) con contraseña, AOF, `noeviction`, healthcheck
  autenticado, puerto solo en `127.0.0.1` y volumen. La API espera a que esté `healthy` y recibe `REDIS_HOST=redis`.
- Variables `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` y `CACHE_TTL_SEGUNDOS`; `redisUrl()` y `cacheTtlSegundos()` en
  `config/env.ts` (funciones, como `mongoUri()`, para que `migrar` no las exija).
- [src/datos/redis.ts](src/datos/redis.ts): cliente oficial con el ciclo de vida de la letra (`on('error')`, `connect()` al
  arrancar, `quit()` al cerrar). `servidor.ts` y `db:verificar` lo usan.
- [src/servicios/crearCacheActivos.ts](src/servicios/crearCacheActivos.ts): caché cache-aside (String + TTL) y ranking de
  consultas (Sorted Set). `GET /api/activos/:id` informa `X-Cache: HIT | MISS`; `PUT` y `DELETE` invalidan.
- [src/servicios/crearServicioPreferencias.ts](src/servicios/crearServicioPreferencias.ts): `GET` y `PUT /api/preferencias`
  sobre un Hash (`HSET` / `HGETALL`), validadas con Zod.
- Tests con un Redis falso en memoria ([pruebas/ayudas/redisFalso.ts](pruebas/ayudas/redisFalso.ts)), 11 requests nuevos en
  Postman y README con la sección de Redis.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| La caché es de **mejor esfuerzo** (Redis caído → se sirve de MySQL); las preferencias dan **503** | Claude | La caché es una copia; las preferencias solo existen en Redis y no hay nada que devolver |
| Solo la lectura pública por id usa la caché | Claude | Actualizar y eliminar deciden con el dato real de MySQL |
| `disableOfflineQueue` y no reintentar al arrancar | Claude | Con Redis caído los comandos fallan en el acto (un `GET` respondió en 6 ms) y la API no levanta sin Redis, igual que con las otras bases |
| `cerrarRedis()` aparte de `cerrarConexiones()` (**cambia el plan**, que decía sumarlo a esta) | Claude | `conexiones.ts` lo importa `migrar`, que no debe exigir las variables de Redis |
| La lógica cache-aside vive en la fábrica (`consultar`) y no en `activosServicio` | Claude | Así se prueba sin Redis real; hubo que moverla después de ver que quedaba sin test |
| `PUT /api/preferencias` actualiza solo los campos enviados | Claude | Con un Hash tiene sentido tocar un campo sin pisar el otro. Una sola billetera por ahora; por usuario en la Parte 6 |
| Los requests de Postman se agregan en esta sesión, no al cerrar la Parte 5 | Claude | Se pueden verificar ya, y cada sesión deja la colección en verde |
| `describirError` muestra el código de un `AggregateError` | Claude | El error de Redis sin servidor decía solo "AggregateError"; ahora dice `ECONNREFUSED` |

**Hallazgo: la invalidación se puede perder.** Con Redis caído, un `PUT` no puede invalidar la clave; al volver Redis (los
datos persisten por AOF) un `GET` devolvió `cantidad: 1` cuando MySQL ya tenía `3`, hasta que venció el TTL de 60 s. Es el
costo de una caché de mejor esfuerzo, y la razón de mantener un TTL corto. Queda documentado en el README; la Parte 7 (CQRS y
Pub/Sub) vuelve sobre cómo sincronizar la caché.

**Verificación**
- `npm run check` y `npm run build` sin errores; `npm test`: 17 suites, **187 tests** en verde (29 nuevos).
- Mutaciones (3): no guardar el activo tras un MISS, guardarlo sin TTL y no validar el id leído de la caché → las 3 detectadas.
- Redis real: `MISS` y luego `HIT` con `TTL` descontando; el `PUT` borra la clave y la siguiente lectura es `MISS` con el
  dato nuevo; el `DELETE` borra la clave y saca el id del ranking; un id inexistente da 404 y no deja rastro en Redis.
- Preferencias: valores por defecto, `PUT` completo y parcial, `HGETALL` coincide, y un cuerpo inválido da 400 con los dos errores.
- **Redis detenido con la API corriendo:** `GET` por id → 200 (desde MySQL), preferencias → 503, `POST` → 201 y `PUT` → 200.
  Al volver Redis, la API se reconectó sola.
- Arranque con Redis detenido: `db:verificar` falla en 2,8 s con "No se pudo conectar a Redis".
- Newman, dos corridas seguidas, tanto con la API local como con la API **dentro de Docker**: 81 aserciones, 0 fallas.
- Compose: los cuatro servicios `healthy`; Redis exige contraseña (`NOAUTH` sin ella) y la contraseña no aparece en
  `docker inspect`; `docker compose stop api` (SIGTERM real) cierra con código 0.

**Pendientes / a tener en cuenta**
- El arranque desde cero (`docker compose down -v`) no se repitió en esta sesión: no se tocó nada de MySQL y Mongo, y Redis
  no tiene una fase de inicialización como esas.
- Los contenedores quedan corriendo al cerrar la sesión.
- Siguiente: sesión 10 (BullMQ: cola de reportes y worker), que cierra la Parte 5.

---

## Sesión 10 — BullMQ: cola de reportes y worker · 2026-10-30

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (igual que la sesión 9; el estudiante dijo "seguimos" después de que se
  apagó la computadora y no se cambió nada).
- **Modo:** implementación, en `feature/sesion-10-bullmq-reportes`.
- **Contexto:** antes de empezar se comprobó que el repo, `develop` publicada y los volúmenes de Docker estaban intactos tras
  el apagón (los contenedores se reiniciaron solos).
- **Herramientas:** edición de archivos, `npm install` (`bullmq`, `ioredis`), Docker Compose, `redis-cli` y `mongosh` dentro de
  los contenedores, `curl`, Newman y scripts descartables de prueba de humo. Sin skills ni subagentes (el `/code-review` de
  cierre de la Parte 5 se registra aparte).

**Qué se hizo**
- Cola `cola-reportes` con BullMQ: [src/colas/colaReportes.ts](src/colas/colaReportes.ts) (productor) y
  [src/servicios/crearServicioReportes.ts](src/servicios/crearServicioReportes.ts).
- `POST /api/activos/reporte` → **202** con `Location` y el id; `GET /api/reportes/:id` → estado (`en_cola`, `procesando`,
  `completado`, `fallido`), progreso, resultado o motivo; `GET /api/estadisticas` → reportes exitosos y los 5 activos más consultados.
- [src/reportes/](src/reportes/): `generarReporte` (valoración masiva con una sola llamada a CoinGecko, demora simulada y
  progreso), `procesadorReporte` (genera + audita), `eventosWorker` (`completed` / `failed` a Winston, `INCR` del contador) y
  `estadoReporte`. Todo con dependencias por parámetro.
- Worker como proceso aparte: [src/procesos/workerReportes.ts](src/procesos/workerReportes.ts), `npm run worker` y servicio
  `worker-reportes` en el compose (misma imagen, otro comando).
- `preciosServicio.obtenerPrecios` (varios símbolos, una llamada); auditoría con `GENERAR_REPORTE` y entidad `Reporte`.
- 5 requests de Postman nuevos (con *polling*), README (cola, worker, tabla "letra → proyecto") y
  [RESPUESTAS-PARTE-5.md](RESPUESTAS-PARTE-5.md).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| BullMQ en lugar de Bull | Estudiante, a propuesta de Claude (sesión 8) | Bull está en mantenimiento |
| BullMQ con **`ioredis`**, no con el cliente oficial `redis` (**cambia el plan**) | Claude | El plan decía que BullMQ "trae `ioredis`"; en la versión 6 es opcional. Se probó el adaptador del cliente oficial con un script: el flujo normal anduvo pero una caída de Redis tumbaba el proceso y la recuperación no fue limpia. Con `ioredis` el mismo guion pasó completo |
| El worker es otro proceso, misma imagen | Claude (según el plan) | Se detiene o reinicia sin tocar la API; no se multiplica con el cluster de la Parte 8 |
| Un fallo al auditar un reporte **hace fallar el trabajo** | Claude | Un reporte se regenera y la cola reintenta; a diferencia del CRUD no hay una operación irreversible detrás |
| La cola falla en el acto con Redis caído (`enableOfflineQueue: false`) → 503 | Claude | Si no, `add` queda esperando y la API no puede responder |
| Un id de reporte que no es UUID da 404 sin consultar Redis | Claude | `GET /api/reportes/meta` habría leído la configuración interna de la cola |
| 3 intentos con espera 1 s y 2 s; trabajos terminados se borran a la hora, los fallidos al día | Claude | Fallos pasajeros no pierden el reporte; Redis no crece sin límite |
| Los símbolos sin cotización van a `sinPrecio` y no hacen fallar el reporte | Claude | Un símbolo raro no debe invalidar todo el portafolio |
| El resultado del reporte vive en el trabajo (Redis), no en una base | Claude | Alcanza para la letra; queda como mejora |
| Los requests de Postman se agregan en esta sesión | Claude | Cada sesión deja la colección en verde |

**Verificación**
- `npm run check` y `npm run build` sin errores; `npm test`: 23 suites, **242 tests** en verde (55 nuevos: generador, procesador,
  eventos, servicio de reportes, estadísticas, estados y configuración de la cola).
- Prueba de humo previa contra el Redis real (BullMQ + `ioredis`): éxito con progreso, reintentos, `add` con Redis caído falla en
  1 ms, y tras volver Redis el productor y el worker siguen funcionando.
- En Docker (API + worker + 3 bases, todo `healthy`): `POST` → 202 en 0,2 s; el seguimiento muestra `procesando` 10 % → 53 % →
  78 % → `completado`; el resultado valúa BTC y ETH y deja `RARO` en `sinPrecio`; el log dice `completado` con el contador en 1;
  en MongoDB hay un `GENERAR_REPORTE` sobre la entidad `Reporte`.
- **CoinGecko roto** (worker apuntando a una URL que no responde): 3 intentos con espera creciente, estado `fallido` con el motivo,
  el contador no cambia y no hay registro de auditoría.
- **Worker detenido:** el pedido queda `en_cola` y se procesa al volver el worker.
- **Cierre ordenado:** `docker compose stop worker-reportes` a mitad de un reporte lo termina y sale con código 0 en 1,7 s.
- **Redis detenido:** `POST /api/activos/reporte`, `GET /api/reportes/:id` y `GET /api/estadisticas` → 503; `GET /api/activos`
  (MySQL) → 200; al volver Redis todo se recupera solo.
- Newman, dos corridas seguidas, API en Docker: 96 y 95 aserciones, 0 fallas (la diferencia es el *polling*).

**Hallazgos y pendientes**
- **Límite gratuito de CoinGecko (HTTP 429):** una corrida de Newman hizo fallar un reporte tras 3 intentos. El sistema se
  comportó como debe, pero deja la colección intermitente si se corre muchas veces seguidas; el test ahora informa el motivo y
  el README lo advierte. Mejora anotada: respetar `Retry-After` y cachear cotizaciones en Redis.
- **Nunca se probó más de un worker a la vez**, ni el `INCR` bajo concurrencia real; se afirma solo que es atómico por el comando.
- `POST /api/activos/reporte` es la operación más cara de la API y hoy no tiene autenticación: la Parte 6 la deja solo para el ADMIN.
- Siguiente: cierre de la Parte 5 (`/code-review`, correcciones, OK del estudiante, merge a `main` y mensaje al profesor).

---

## Revisión de código de la Parte 5 · 2026-10-30

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Skill usada:** `/code-review` en nivel *high* sobre lo que `develop` tenía de más que `main` (sesiones 8 a 10). Devolvió **9
  hallazgos**, que se evaluaron uno por uno en `fix/revision-parte-5`.

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | MySQL no distingue mayúsculas en los ids pero las claves de Redis sí: un mismo activo tenía varias claves, y un `PUT` o `DELETE` con otras mayúsculas dejaba la entrada vieja | **Corregido:** todo lo que toca Redis usa el id en minúsculas (4 tests nuevos; verificado con la API real) |
| 2 | Si falla la invalidación (Redis con un corte breve), la caché sirve el dato viejo hasta el TTL | **No se corrige.** Es el límite ya documentado de una caché de mejor esfuerzo (se vio en la sesión 9); la Parte 7 vuelve sobre esto |
| 3 | Si Redis responde lento (más de 2 s) el `add` puede encolar después de dar 503, y un reintento genera dos reportes | **Documentado** en el código, el README y `RESPUESTAS-PARTE-5.md`; con Redis caído no pasa. Se resolvería con una clave de idempotencia |
| 4 | La carrera contra un tiempo máximo estaba copiada en la auditoría y en los reportes | **Corregido:** helper `conTiempoMaximo` compartido, con 5 tests |
| 5 | El `ZINCRBY` del ranking se esperaba en la ruta caliente de la lectura | **Corregido:** ya no se espera (nunca rechaza), con lo que el `GET` hace un solo viaje a Redis en un HIT |
| 6 | El cierre del worker no tenía `.catch`: con Redis caído al apagar moría sin cerrar las conexiones ni loguear | **Corregido:** se loguea, se cierra el resto y sale con código 1 |
| 7 | El contador de reportes puede perder un conteo (si el worker cae justo después de completar) o duplicarlo (si se reprocesa) | **Documentado** como mejora (`SADD` por id de reporte); ya era de mejor esfuerzo |
| 8 | Un fallo de MySQL al buscar un símbolo hacía fallar con 500 todas las estadísticas | **Corregido:** se devuelve el dato de Redis sin el símbolo y se loguea |
| 9 | `CLAUDE.md` decía que `REDIS_*` se lee con `redisUrl()`, pero se sumó `redisConfig()` para BullMQ | **Corregido:** la documentación nombra las dos |

**Verificación:** `check` y 252 tests en verde (10 nuevos). Mutaciones: sin normalizar el id → 4 tests fallan; sin degradar las estadísticas →
1 falla. Con la API real: un `GET` con el id en mayúsculas da `MISS` y luego `HIT`, hay una sola clave en Redis, el `PUT` con
mayúsculas invalida y el ranking no se parte. Newman, dos corridas: 96 aserciones, 0 fallas. `docker compose stop worker-reportes` a
mitad de un reporte lo termina y sale con código 0.

**Pendiente:** el OK del estudiante para el merge de `develop` a `main` y el mensaje al profesor.

---

## Sesión 11 — Auth0 y middleware JWT · 2026-10-30

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (la misma sesión que las 9 y 10; el plan sugería Opus 5.5 para esta sesión por
  ser seguridad, pero el estudiante siguió con Sonnet).
- **Modo:** implementación, en `feature/sesion-11-auth0-jwt`.
- **Herramientas:** edición de archivos, `npm install jose`, Docker Compose, `curl`, Newman y pruebas de mutación a mano. Sin skills
  ni subagentes (el `/code-review` y el `/security-review` de cierre de la Parte 6 van en la sesión 12). Docker Desktop estaba apagado
  (la compu se reinició): Claude lo prendió.

**Qué se hizo**
- [src/seguridad/verificadorJwt.ts](src/seguridad/verificadorJwt.ts): verifica el JWT con `jose` (firma con las JWKS, solo `RS256`,
  `iss`, `aud`, `exp`, `nbf`, `sub`) y devuelve `{ sub, roles }`. 401 si el token es inválido o venció; 503 si no se pueden bajar las claves.
- [src/middlewares/autenticacion.ts](src/middlewares/autenticacion.ts): exige `Authorization: Bearer <token>`, deja al usuario en la
  petición y responde 401 con `WWW-Authenticate`. Todo `/api` pasa por él; `/salud` sigue público. `GET /api/yo` muestra quién es el usuario.
- [src/seguridad/autenticacion.ts](src/seguridad/autenticacion.ts): el cableado con `createRemoteJWKSet` (claves en memoria, 3 s de
  tiempo máximo, descarga como mucho cada 30 s ante un `kid` desconocido).
- Variables `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_CLAIM_ROLES`; [AUTH0.md](AUTH0.md) con la guía paso a paso.
- [herramientas/idpFalso.ts](herramientas/idpFalso.ts) (`npm run idp:falso`): proveedor de identidad falso para desarrollo.
- Postman: autenticación a nivel de colección, `T1`–`T3` (piden los tokens) y 4 requests de 401; entornos de ejemplo y del proveedor falso.

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Auth0 (opción B) | Estudiante (sesión 8) | Es la recomendada por la letra |
| La API solo **verifica**; no emite tokens ni guarda usuarios | Claude (según el plan) | Es lo que significa delegar la autenticación |
| Algoritmo fijo `RS256` | Claude | Sin lista cerrada, `alg: none` o la confusión HS256/RS256 podrían pasar |
| 503 (y no 401) si no se pueden bajar las claves | Claude | Es una falla del proveedor, no del cliente |
| El mensaje de un token inválido no dice qué falló; el de uno vencido sí | Claude | Lo primero no ayuda a un atacante; lo segundo le sirve al cliente legítimo para renovarlo |
| Los roles se leen de un claim configurable; los que no se conocen se descartan | Claude | No se ata la app a Auth0 ni se confía en roles inventados |
| Un usuario autenticado **sin roles** es válido (queda para la autorización decidir qué puede hacer) | Claude | La autenticación solo dice *quién* es |
| Proveedor de identidad falso como herramienta de desarrollo, fuera de `src/` y de la imagen | Claude, **a validar** | Permite probar de punta a punta, y correr Newman y k6 después, sin cuenta externa ni credenciales en el repo. Se puede borrar sin tocar nada más |
| El entorno de Postman con credenciales reales no se versiona (hay un `.ejemplo`) | Claude | Tiene contraseñas |

**Verificación**
- `npm run check` y `npm test`: 26 suites, **310 tests** en verde (58 nuevos: verificador y middleware, con claves generadas al momento, sin red).
- Mutaciones (6): sin `issuer`, sin `audience`, tolerancia de reloj enorme, roles sin filtrar, token vencido como 503 y error de red como 401 → las 6 detectadas.
- Con la API real y el proveedor falso: sin token 401 con `WWW-Authenticate`; token basura, vencido, con esquema `Basic` y con el cuerpo
  alterado (se hacía pasar por ADMIN) → 401; token válido → 200; `/salud` público; rutas inexistentes dan 404 con token y 401 sin él.
- **Proveedor caído:** una API que ya tenía las claves en memoria sigue autenticando (200); una que nunca las bajó responde 503 en 21 ms,
  y sin token o con basura sigue dando 401.
- Latencia de una petición autenticada con las claves en memoria: ~4 ms.
- Newman con el proveedor falso, dos corridas: **111 aserciones, 0 fallas** (una corrida previa falló solo en un request de precio por el límite 429 de CoinGecko).
- Docker: los cinco servicios `healthy` con los valores de ejemplo de Auth0 en el `.env`; sin token → 401.

**Hallazgos**
- `pm.sendRequest` de Postman **no hereda** la autenticación de la colección: el request de limpieza daba 401 en sus `DELETE` y dejaba
  datos viejos. Se le manda el token a mano.
- Con la caché de claves de `jose`, si el proveedor falso se reinicia (claves nuevas con el mismo `kid`), la API sigue con las viejas hasta
  reiniciarse: es el comportamiento normal de la caché y no ocurre con Auth0, que rota sus claves con `kid` distinto.

**Pendientes**
- ~~El estudiante tiene que crear la cuenta de Auth0 y probar con ella.~~ **Hecho el 2026-10-31** (ver abajo): el estudiante creó el tenant
  `dev-td5pv7bdpswwexhr` (región US) y la API se probó contra Auth0 real.
- Siguiente: sesión 12 (roles y autorización, modo pánico y cierre de la Parte 6).

**Verificación con Auth0 real · 2026-10-31**
- El estudiante creó la cuenta y el tenant y pasó el Client ID de la aplicación Native; Claude completó el `.env` (`AUTH_ISSUER` y
  `AUTH_JWKS_URL`, comprobados contra `/.well-known/openid-configuration`) y armó el entorno de Postman (fuera de git). La contraseña de
  los usuarios la escribió el estudiante en el archivo, nunca se la pasó a Claude ni se muestra en ningún informe.
- **Hallazgo:** el primer pedido de token falló con `Client "..." is not authorized to access resource server`. Faltaba **autorizar la
  aplicación en la API** (pestaña *Application Access*). La guía lo tenía solo en la tabla de problemas; se agregó como paso 6.5.
- Resultado: los tres usuarios obtienen su token con el rol correcto (`["AUDITOR"]`, `["TRADER"]`, `["ADMIN"]`), `iss` y `aud` coinciden (la
  audiencia llega como lista `[api, userinfo]`, que el verificador ya aceptaba) y **Newman con Auth0 real da 111 aserciones, 0 fallas** con la
  API en Docker: `GET /api/yo` → 200 y los casos de 401 (sin token, inválido y manipulado) → 401.
- Docker Desktop se apagó otra vez por un reinicio de la compu; Claude lo prendió.

---

## Sesión 12 — Roles, modo pánico y administración · 2026-10-31

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (igual que las sesiones 9 a 11; el plan sugería Sonnet 5.5 para esta).
- **Modo:** implementación, en `feature/sesion-12-roles-modo-panico`.
- **Herramientas:** edición de archivos, Docker Compose, `curl` con **tokens reales de Auth0**, Newman y mutaciones a mano. Sin skills ni
  subagentes (la revisión de cierre va en la entrada siguiente). Docker Desktop estaba apagado y Claude lo prendió.

**Qué se hizo**
- **Autorización por roles (RBAC):** [src/seguridad/autorizar.ts](src/seguridad/autorizar.ts) (403, con log de cada acceso denegado) y la matriz
  declarada en [src/seguridad/permisos.ts](src/seguridad/permisos.ts); cada ruta de [activosRutas.ts](src/rutas/activosRutas.ts) declara su permiso.
- **Modo pánico:** [src/seguridad/modoPanico.ts](src/seguridad/modoPanico.ts), `SET modo_panico true` en Redis; bloquea las escrituras de
  TRADER y AUDITOR con 403, no bloquea al ADMIN, y falla cerrado (503) si no puede leer Redis.
- **Administración (solo ADMIN):** `DELETE /api/admin/cache` (`SCAN` + borrar solo `activo:*`) y `GET`/`PUT /api/admin/modo-panico`.
- **Preferencias por usuario** (`preferencias:<sub>`) y el `sub` del usuario en `metadatos.usuario` de la auditoría del CRUD y de los reportes.
- Un **test de contrato** ([pruebas/rutas/permisosDeRutas.test.ts](pruebas/rutas/permisosDeRutas.test.ts)) que falla si una ruta no declara su permiso o declara otro.
- Postman: tokens por rol en los requests existentes, `T4` (apaga el modo pánico por si una corrida quedó a medias) y 19 casos nuevos de
  permisos, modo pánico y preferencias por usuario. README y [RESPUESTAS-PARTE-6.md](RESPUESTAS-PARTE-6.md).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Matriz: el AUDITOR lee todo, **incluida** la auditoría general; el TRADER **no** ve la auditoría general ni las estadísticas | Claude, según el plan (a validar) | La letra dice que el AUDITOR consulta el historial; el TRADER "no accede a procesos administrativos" |
| `POST /api/activos/analizar` solo para TRADER y ADMIN, y **no** se bloquea en modo pánico | Claude | Es un `POST` pero no guarda nada: la letra pide bloquear los endpoints de **escritura** |
| El ADMIN nunca se bloquea en modo pánico, ni siquiera se consulta Redis para él | Claude | Tiene que poder operar y apagar el modo |
| El modo pánico **falla cerrado** (503 si no se puede leer) | Claude | Ante la duda durante un incidente no se escribe |
| Limpiar la caché borra solo `activo:*`, con `SCAN`; nunca `FLUSHALL` | Claude | Redis guarda también la cola, las preferencias, los contadores y el modo pánico |
| 403 y no 404 para lo que el rol no permite | Claude | El usuario está autenticado; ocultar con 404 confundiría al cliente legítimo |
| Un usuario autenticado sin roles recibe 403 en todo menos `/yo` | Claude | La autenticación dice *quién*; sin rol no tiene permiso para nada |
| La clave `preferencias:billetera` quedó huérfana al pasar a preferencias por usuario | Claude | Eran datos de desarrollo; no se migraron |
| Quién activó el modo pánico / limpió la caché va al **log**, no a MongoDB | Claude | Alcance de la sesión; queda como mejora |

**Verificación**
- `npm run check` y `npm test`: 30 suites, **385 tests** en verde (73 nuevos: autorización por rol, modo pánico, limpieza de caché, permisos de las
  rutas y preferencias por usuario).
- Mutaciones (6): autorización que deja pasar a todos, el ADMIN también se bloquea, el modo pánico falla **abierto**, limpiar la caché borra todo
  Redis, `/estadisticas` abierta a todos y `DELETE` sin bloqueo de modo pánico → las 6 detectadas.
- **Con tokens reales de Auth0 (los tres usuarios)**, matriz de 12 endpoints × 3 roles: **todas las celdas coinciden con lo esperado**. Sin token → 401.
- **Modo pánico:** el TRADER recibe 403 en `POST`, `PUT`, `DELETE` y `PUT /preferencias`; `GET` y `analizar` siguen en 200; el ADMIN sigue escribiendo
  (201); `redis-cli get modo_panico` da `true`; al apagarlo el TRADER vuelve a escribir.
- **Con Redis detenido:** TRADER `POST` → 503 (no deja escribir), ADMIN `POST` → 201, TRADER `GET` → 200; al volver Redis se recupera solo.
- **Preferencias por usuario:** el TRADER guarda UYU/777 y el ADMIN sigue viendo USD/100000; hay una clave por usuario.
- **Limpiar la caché:** borró 1 entrada `activo:*` y dejó intactas las claves `preferencias:*` (3), `bull:*` (10), `estadisticas:*` (1) y el ranking.
- **Auditoría:** los `CREAR` y `ACTUALIZAR` en MongoDB traen `metadatos.usuario` con el `sub` de quien los hizo.
- Newman con **Auth0 real**, dos corridas: 70 requests, 147 y 146 aserciones, **0 fallas**.

**Hallazgos**
- Mi Redis falso recorría `SCAN` con un índice como cursor y se saltaba claves al borrar a mitad del recorrido (el `SCAN` real no lo hace). Lo
  encontró un test y se corrigió el falso; no era un bug de la aplicación.
- **Un token de Auth0 dura 24 horas** en este tenant: un cambio de rol o un bloqueo no se nota hasta que el token vence. Limitación documentada.
- Git Bash convierte `/ruta` en una ruta de Windows con `MSYS_NO_PATHCONV` y rompe `-o /dev/null`: es un detalle de mis scripts de prueba.

**Pendientes**
- Cierre de la Parte 6: `/code-review` y `/security-review`, correcciones, OK del estudiante, merge a `main`.
- A validar por el estudiante: la matriz de permisos (en especial que el TRADER no vea la auditoría general).

---

## Revisión de la Parte 6 · 2026-10-31

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Skills usadas:** `/code-review` en nivel *high* y `/security-review`, sobre lo que `develop` tenía de más que `main` (sesiones 11 y 12).
  Las correcciones se hicieron en `fix/revision-parte-6`.

### `/code-review` · 10 hallazgos

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | `express.json()` corría antes de `autenticar`: a un anónimo se le parseaba el cuerpo (y con JSON roto recibía 400, no 401) | **Corregido:** el parser va después de autenticar. Verificado con la API real: sin token, JSON roto → 401 |
| 2 | Todo error que no fuera de `jose` se traducía a 503 "el proveedor no responde", escondiendo un bug propio | **Corregido:** solo se marca como fallo del proveedor lo que falla al pedir la clave; el resto sale como 500 con su stack. Test nuevo |
| 3 | Con el proveedor caído y sin claves en memoria cada petición espera hasta 3 s (no hay caché negativa) | **Documentado** (en el código, el README y `RESPUESTAS-PARTE-6.md`). Un cortacircuitos delante de `jose` podría bloquear también las claves que sí están en memoria |
| 4 | El modo pánico falla cerrado y consulta Redis en cada escritura: una caída breve de Redis da 503 a las escrituras de TRADER | **Documentado:** es el compromiso elegido (rechazar ante la duda). Se agregó la advertencia al README |
| 5 | `describir()` duplicaba `describirError` | **Corregido** |
| 6 | La clave `preferencias:billetera` quedó huérfana al pasar a preferencias por usuario | **No se corrige:** eran datos de desarrollo y ya estaba documentado; se borró la clave del Redis local |
| 7 | `solicitadoPor` era obligatorio pero los trabajos ya encolados antes de la Parte 6 no lo traen | **Corregido:** pasó a opcional, con tests |
| 8 | Los accesos denegados se logueaban como `info`; se dijo que `req.path` permitía inyectar líneas | Nivel **corregido a `warn`** (se agregó `warn` al registrador). **La inyección no aplica:** `req.path` de Express llega sin decodificar |
| 9 | `idpFalso` aceptaba `__proto__` o `constructor` como usuario y un `vence_en` no numérico daba 500 | **Corregido** (`Object.hasOwn` y validación) |
| 10 | `PUT /preferencias` se bloquea en modo pánico y el AUDITOR nunca puede guardar sus preferencias | **No se corrige:** la letra pide bloquear **todas** las escrituras y que el AUDITOR no modifique nada |

**Hallazgo extra, no marcado por la revisión:** al probar el punto 1 con un cuerpo de 1 MB, la API daba **500** en lugar de 413 (defecto anterior:
el manejador de errores solo conocía el JSON roto). Se corrigió: 413 para un cuerpo demasiado grande y 415 para un tipo de contenido no soportado.

### `/security-review` · sin vulnerabilidades de alta confianza

Revisó la verificación del JWT (firma, algoritmo `RS256` fijo, `iss`, `aud`, `exp`), que `autenticar` va antes que todas las rutas, la matriz de roles
y su test de contrato, el modo pánico, las preferencias por usuario, la limpieza de caché con `SCAN` (patrón fijo `activo:*`), las claves de Redis
armadas con datos del cliente, la fuga de información en logs y respuestas y la herramienta del proveedor falso. Dos observaciones menores, ya
documentadas como limitaciones: los roles viajan en el token (un cambio de rol se nota recién cuando vence, 24 h) y la espera de 3 s con el
proveedor caído y sin claves en memoria. La consigna de la skill está en inglés; el informe se entregó en español.

**Verificación:** `check` y **388 tests** en verde (3 nuevos); con la API real: sin token + JSON roto → 401, con token + JSON roto → 400, con token + 1 MB → 413.

**Pendiente:** el OK del estudiante para el merge de `develop` a `main` (cierre de la Parte 6).

---

## Partes 5 y 6 en `main` · 2026-10-30 y 2026-11-04

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Parte 5 (2026-10-30):** el estudiante dio el OK después del `/code-review`; se hizo el merge `--no-ff` de `develop` a `main` y el push. Había 252 tests y
  Newman con 0 fallas.
- **Parte 6 (2026-11-04):** el estudiante respondió "vamos sigamos" a la pregunta "¿hago el merge de la Parte 6 a `main` y seguimos con la sesión 13?", y se
  hizo el merge. Estado al cerrar: `check` y 388 tests en verde, Newman con Auth0 real con 0 fallas, `/code-review` y `/security-review` hechas y registradas.
- Los commits de ambas partes no llevan `Co-Authored-By` ni mención a Claude.
- **Siguiente:** sesión 13 (CQRS: comandos, consultas y publicación de eventos), en `feature/sesion-13-cqrs`.

---

## Sesión 13 — CQRS: comandos, consultas y eventos · 2026-11-04

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (igual que las sesiones 9 a 12; el plan sugería Sonnet 5.5 para esta).
- **Modo:** implementación, en `feature/sesion-13-cqrs`.
- **Herramientas:** edición de archivos, Docker Compose, `curl` con **tokens reales de Auth0**, `redis-cli subscribe`, `SHOW GLOBAL STATUS` de MySQL,
  Newman y mutaciones a mano. Sin skills ni subagentes. Antes de empezar se cerró la Parte 6 en `main` (ver la entrada anterior).

**Qué se hizo**
- **El servicio de activos se partió en dos**, cada uno una fábrica con todo por parámetro: [comandos](src/servicios/comandos/crearComandosActivos.ts)
  (crear, actualizar, eliminar: validan, persisten en MySQL, invalidan la caché, auditan y publican) y
  [consultas](src/servicios/consultas/crearConsultasActivos.ts) (listar, ver, precio e historial: leen de Redis y caen a MySQL). `activosServicio.ts` se eliminó.
- **El modelo de lectura se completó:** `GET /api/activos` ahora también sale de Redis (`activos:todos`, con TTL) y lleva `X-Cache`. El filtro `?simbolo=` se
  aplica sobre la lista cacheada, y el activo de `/precio` sale del modelo de lectura.
- **Eventos:** [contrato versionado](src/eventos/eventoActivo.ts) (Zod: `ACTIVO_CREADO`, `ACTIVO_ACTUALIZADO`, `ACTIVO_ELIMINADO`, con `antes`, `despues`, campos
  modificados y quién lo hizo) y [publicador](src/eventos/crearPublicador.ts) sobre `PUBLISH activos-actualizaciones`, de mejor esfuerzo.
- `SimboloDuplicadoError` pasó a un módulo propio (sin Sequelize) para poder probar los comandos sin base. Limpiar la caché también borra `activos:todos`.
- Postman: 6 requests nuevos del modelo de lectura (`MISS` y `HIT` de la lista tras un comando). README con la sección "CQRS: comandos, consultas y eventos".

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Los comandos **siguen** invalidando la caché y auditando directamente en esta sesión | Claude, según el plan | Nadie escucha todavía el canal: la app tiene que quedar funcionando. En la sesión 14 lo hacen los suscriptores |
| Publicar es de mejor esfuerzo: nunca rechaza y la operación responde bien aunque falle | Claude | MySQL ya confirmó y no se puede deshacer; mismo criterio que la caché y la auditoría del CRUD |
| El evento se publica **después** de la auditoría y de invalidar la caché, y se valida antes de publicar | Claude | Nunca se anuncia algo que no ocurrió; un evento que viole el contrato sería un bug nuestro y los suscriptores lo descartarían |
| La lista completa se cachea como un solo valor y el filtro se aplica en memoria | Claude | El portafolio es chico; un solo `GET` de Redis sirve cualquier filtro |
| `GET /api/activos/:id/precio` usa el activo del modelo de lectura; la cotización nunca se cachea | Claude | El activo es un dato propio que cambia por comandos; la cotización es de un tercero |
| El log del publicador es `info` aunque haya 0 receptores | Claude | En esta etapa nadie escucha y un `warn` por cada escritura sería ruido; la sesión 14 lo revisa cuando haya suscriptores |
| El contrato lleva `version` | Claude | Si cambia la forma del mensaje, los suscriptores pueden distinguirlo |

**Verificación**
- `npm run check` y `npm test`: 34 suites, **452 tests** en verde (64 nuevos: contrato del evento, publicador, comandos, consultas, lista cacheada y administración).
- Mutaciones (10): el `DELETE` sin evento, el `POST` sin invalidar la lista, el `PUT` sin los campos modificados, publicar antes de confirmar en MySQL,
  un `ACTIVO_CREADO` sin `despues` que pasa el contrato, publicar sin validar, un publicador que rechaza si Redis falla, un filtro por símbolo que no filtra,
  limpiar la caché sin borrar la lista y una lista que no vence → las 10 detectadas.
- **Con Auth0 real y Docker:** la lista da `MISS, HIT, HIT` (y el filtro sale de la misma lista cacheada, TTL 58 s); un comando la invalida y la siguiente lectura
  vuelve a ser `MISS`.
- **`redis-cli subscribe` en vivo:** un `POST`, un `PUT` y un `DELETE` produjeron 3 mensajes con el contrato (`ACTIVO_CREADO`, `ACTIVO_ACTUALIZADO` con
  `camposModificados: [cantidad, precioCompra]` y `ACTIVO_ELIMINADO`), con `version`, `idEvento` y el `sub` del usuario. El log de la API dice `receptores: 1`
  con el suscriptor conectado y `receptores: 0` sin él.
- **Carga sobre MySQL (`Com_select`), 100 lecturas de `GET /api/activos`:** **0** consultas con Redis como modelo de lectura contra **100** sin Redis.
- **Redis detenido:** el ADMIN crea un activo y responde 201 (la caché y el evento fallan y quedan en el log, la lista se sirve desde MySQL); el TRADER recibe 503,
  porque el modo pánico de la Parte 6 falla cerrado. Al volver Redis todo se recupera solo.
- Newman con Auth0 real, dos corridas: 76 requests, **161 aserciones, 0 fallas**.

**Hallazgos**
- Mi primer guion esperaba un 201 del TRADER con Redis caído y dio 503: no es un error de esta sesión, es la regla de la Parte 6 (el modo pánico falla cerrado).
  Para ver el mejor esfuerzo hay que usar al ADMIN, que no se bloquea. Queda anotado en el README.
- La API ahora publica un evento por cada escritura aunque **nadie escuche** (`receptores: 0`): la pérdida de ese evento es silenciosa. La sesión 14 lo trabaja
  (suscriptores, y la comparación con BullMQ que pide el reto de la letra).

**Pendientes**
- Sesión 14: los **suscriptores** (proyecciones: caché, ranking y auditoría; y notificaciones de Whale Alert), la demostración de la pérdida de mensajes,
  `RESPUESTAS-PARTE-7.md`, las revisiones y el cierre de la Parte 7.

---

## Sesión 14 — Pub/Sub: suscriptores y cierre de la Parte 7 · 2026-11-04

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto. El plan sugería Opus 5.5 para esta sesión (consistencia asíncrona); el estudiante respondió "dale" a
  "¿sigo con la sesión 14?" sin pedir otro modelo, así que siguió la misma sesión y el mismo modelo que las 9 a 13.
- **Modo:** implementación, en `feature/sesion-14-pubsub`.
- **Herramientas:** edición de archivos, Docker Compose (los siete servicios), `curl` con **tokens reales de Auth0**, `redis-cli` (`PUBLISH`), `mongosh`,
  Newman y mutaciones a mano. Sin skills ni subagentes (las revisiones del cierre de la parte van en su propia entrada).

**Qué se hizo**
- **Los comandos quedaron en lo que pide el patrón:** validan, persisten en MySQL y publican. Ya no reciben la caché ni la auditoría.
- **Dos suscriptores, procesos aparte** (misma imagen, otro comando; servicios `suscriptor-proyecciones` y `suscriptor-notificaciones` en el compose, scripts
  `npm run suscriptor:*`). La mecánica común es [`crearSuscriptor`](src/eventos/crearSuscriptor.ts) (valida el contrato, descarta lo inválido, un evento por vez y en
  orden) y [`ejecutarSuscriptor`](src/procesos/ejecutarSuscriptor.ts) (dos conexiones a Redis, reconexión, cierre ordenado).
  - **Proyecciones** ([`crearProyecciones`](src/eventos/crearProyecciones.ts)): invalida la entrada y la lista, saca del ranking al eliminado, cuenta el evento
    (`HINCRBY estadisticas:eventos-activos`) y **audita en Mongo de forma idempotente** por `idEvento` (índice único parcial).
  - **Notificaciones** ([`crearNotificaciones`](src/eventos/crearNotificaciones.ts)): la Whale Alert con el límite de cada usuario o el umbral general. La regla
    (`monto > umbral`) se extrajo a [`whaleAlert.ts`](src/utilidades/whaleAlert.ts) y la comparte el análisis de riesgo.
- `GET /api/estadisticas` suma `eventosActivos` (por tipo). El publicador avisa con **WARN** cuando hay 0 receptores (la sesión 13 lo había dejado como pendiente).
- **El reto** de la letra, demostrado con Docker (suscriptor parado vs worker de BullMQ parado), y la documentación: README (suscriptores, reto, consistencia
  eventual), [`RESPUESTAS-PARTE-7.md`](RESPUESTAS-PARTE-7.md) y `CLAUDE.md`.
- Postman: el contador de eventos en `GET /api/estadisticas` y una espera de 300 ms antes de cada pedido (consistencia eventual).
- `jest.config.js`: `maxWorkers: 1` (ver Hallazgos).

**Decisiones**

| Decisión | Quién | Motivo |
|---|---|---|
| Los comandos **dejan** de invalidar la caché y de auditar; lo hacen los suscriptores | Claude, según el plan y la letra | La letra pide que el comando solo valide y persista. Costo: si el evento se pierde, la caché queda vieja hasta el TTL y la operación no se audita |
| El suscriptor **invalida** la caché en vez de escribir el dato del evento | Claude | Los eventos de un activo pueden llegar en otro orden del que ocurrieron (los publican varias instancias): escribir uno viejo dejaría la caché mal; invalidar nunca deja un dato equivocado. La letra dice "actualizar el caché": se cumple en el sentido del cache-aside |
| La auditoría del suscriptor es **idempotente** (índice único parcial en `idEvento`) | Claude | Un evento repetido no debe duplicar el historial; parcial para que los registros viejos y los reportes no choquen |
| Un evento por vez y en orden de llegada (cola en memoria dentro del suscriptor) | Claude | Que un `ACTUALIZADO` no se aplique antes que el `CREADO` previo. El costo es menos paralelismo, que a este volumen no importa |
| El suscriptor de proyecciones **no conecta MySQL** | Claude | Solo invalida; no reconstruye desde la base. Menos dependencias y arranque más simple |
| La Whale Alert se dispara en `CREADO` y en `ACTUALIZADO` solo si el **monto cambió** | Claude | Cambiar solo el nombre de una posición grande no debería avisar de nuevo |
| Sin preferencia del usuario (o si Redis falla al leerla) rige `UMBRAL_MONTO_USD` | Claude | Una alerta con el límite por defecto vale más que ninguna |
| WARN (y no INFO) con 0 receptores | Claude | Ahora la caché y la auditoría dependen de que alguien escuche |
| Agregar `eventosActivos` a `/api/estadisticas` | Claude | Un contador que nadie puede leer no sirve; es un campo nuevo, no rompe a quien ya consumía la respuesta |
| `maxWorkers: 1` (en banda) en Jest | Claude | La suite se quedaba sin memoria en esta máquina; con 4 y con 2 procesos todavía fallaba a veces, en banda no falló en 6 corridas |

**Verificación**
- `npm run check`, `npm run build` y `npm test`: 39 suites, **496 tests** en verde (44 nuevos: suscriptor, proyecciones, notificaciones, regla de la alerta, duplicado de
  Mongo, estadísticas y publicador). Con `maxWorkers: 1`, seis corridas seguidas de la suite completa en verde.
- **Con Auth0 real y Docker (siete servicios sanos):** un alta, un cambio y una baja → 3 eventos con `receptores: 2`; el historial tiene `CREAR`, `ACTUALIZAR` y
  `ELIMINAR` escritos por el suscriptor; el `GET` posterior al `PUT` es `MISS` y trae el dato nuevo; la Whale Alert aparece en el log de notificaciones con el límite
  del usuario (10.000 USD); `/api/estadisticas` cuenta los eventos por tipo; el índice único parcial existe en Mongo.
- **Idempotencia:** el mismo evento publicado dos veces con `redis-cli` → 1 documento y el log *ya estaba auditado: se ignora*. Un mensaje que no es JSON se descartó con
  un WARN y el suscriptor siguió vivo.
- **El reto:** con el suscriptor de proyecciones parado, el `POST` dio 201 y la API registró `receptores: 1`; la lista cacheada siguió en `HIT` sin el activo nuevo; al
  volver el suscriptor el historial **no** tenía el `CREAR` (no se reenvía). Con el worker de BullMQ parado, el reporte quedó `en_cola` y al volver pasó a `completado`.
- **Reinicio de Redis con los suscriptores corriendo:** se reconectaron solos y el `PUBLISH` siguiente tuvo 2 receptores; un alta posterior quedó auditada.
- Newman con Auth0 real, dos corridas: 81 requests, **162 aserciones, 0 fallas**.
- **Mutaciones (18):** no invalidar la lista o la entrada, el ranking al revés, el contador que suma 2, una operación equivocada, no mandar `idEvento` ni la fecha, un
  suscriptor sin cola o que no descarta lo inválido o al que el error del manejador le rompe la cola, alertar con monto igual al umbral o al eliminar o aunque el monto no
  cambie, ignorar las preferencias o dejar que fallen, 0 receptores sin WARN, eventos faltantes valiendo 1 y el código de duplicado equivocado. **Una sobrevivió** (alertar
  al eliminar: la baja ya estaba cubierta por la falta de `despues`, pero el contrato permite un `ELIMINADO` con `despues`) → se agregó ese caso al test y las 18 quedaron detectadas.

**Hallazgos**
- **Jest se quedaba sin memoria** (`worker ran out of memory`) con un proceso por núcleo (16) y Docker corriendo, en una máquina de 8 GB con unos 300 MB libres; con
  `maxWorkers: 4` y con 2 todavía falló alguna vez (también en la revisión); en banda (`maxWorkers: 1`, unos 8 s) pasó 6 corridas seguidas.
- **Tres requests de Postman** (leer justo después de escribir) dependían de que la auditoría y la caché fueran inmediatas. Pasaron, pero por suerte: se agregó la espera.
- Una vez, en mi guion del reto, el `POST` no devolvió un `id`; al repetir el escenario anduvo y no quedó rastro en los logs de la API. No se pudo atribuir a una causa; queda
  anotado como observación, no como defecto confirmado.

**Pendientes**
- `/code-review` (y `/security-review`) de la Parte 7, corregir lo que salga, el OK del estudiante para el merge a `main` y el **mensaje para el profesor** (el primero que se envía).


---

## Revisión de la Parte 7 · 2026-11-04

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto.
- **Skill:** `/code-review` (nivel *high*) sobre lo que `develop` tenía de más que `main` (sesiones 13 y 14). Corre en un subproceso aparte. La consigna de la skill está
  en inglés; el informe se entregó y se trabajó en español. **No** se corrió `/security-review`: esta parte no toca autenticación, autorización ni datos de entrada
  nuevos (el contrato del evento ya valida lo que recibe); queda para el cierre de la Parte 8.
- **Resultado:** 10 hallazgos. **5 corregidos** (rama `fix/revision-parte-7`) y **5 documentados** como consecuencias del diseño.

| # | Hallazgo | Qué se hizo |
|---|---|---|
| 1 | Los comandos ya no invalidan la caché: un `GET` justo después de un `DELETE`/`PUT` puede devolver el dato viejo, y `npm run dev` no arranca los suscriptores | **Documentado.** Es lo que pide la letra (el comando solo persiste y publica). README: "Limitaciones conocidas" y cómo correr los suscriptores en local |
| 2 | La auditoría del CRUD depende de un suscriptor sin entrega garantizada: se pierden registros si está caído | **Documentado.** Es el límite de Pub/Sub que el reto pide mostrar; mejoras en `RESPUESTAS-PARTE-7.md` (Streams, Outbox) |
| 3 | `historial` de un activo da 404 si su `ELIMINAR` todavía no se auditó y no hay otros registros | **Documentado** (caso extremo de la consistencia eventual) |
| 4 | Si `procesar` rechaza alguna vez, la cola de promesas del suscriptor queda rechazada y deja de procesar todo | **Corregido:** el `.catch` en la cola. Test con un registrador que lanza; la mutación (quitar el `.catch`) se detecta |
| 5 | `ACTIVO_ELIMINADO` se publica con el id de la URL (pueden venir otras mayúsculas) y parte el historial | **Corregido:** usa `actual.id`. Test con un `DELETE` en mayúsculas; mutación detectada. El mismo defecto ya estaba en la auditoría de la sesión 13 |
| 6 | Si un paso de la caché rechaza, no corren el contador ni la auditoría | **Corregido:** cada operación de la caché va en su propio `paso`. Test con los tres métodos rechazando |
| 7 | Las señales se atienden recién después de suscribirse; y mensajes en vuelo podrían entrar tras el `unsubscribe` | **Corregido a medias:** los handlers se registran desde el principio. Lo segundo no ocurre: Redis responde en orden, así que lo que llegó antes del `unsubscribe` ya está en la cola. Se dejó un comentario |
| 8 | El aviso "eventos perdidos mientras estuvo caída" sale también en el primer arranque | **Corregido:** solo se avisa al reconectar, como WARN. Comprobado: arranque limpio sin aviso y, reiniciando Redis, el WARN aparece y el `PUBLISH` siguiente tiene 2 receptores |
| 9 | Dos `PUT` del mismo activo desde instancias distintas pueden publicarse en otro orden y el historial los muestra invertidos | **Documentado** (README y mejoras: número de secuencia por activo) |
| 10 | Publicar sin receptores solo deja un WARN: no hay alarma ni chequeo de salud | **Documentado** (README y mejoras) |

**Verificación tras los arreglos:** `check` y **499 tests** en verde (3 nuevos); las 3 mutaciones de los defectos corregidos, detectadas; con Docker: arranque sin el aviso,
`docker compose stop` de los dos suscriptores en 1 s con salida limpia (código 0) y el log del cierre ordenado, reinicio de Redis con reconexión y resuscripción;
Newman con Auth0 real: 81 requests, **162 aserciones, 0 fallas**.

**Pendiente:** el OK del estudiante para el merge de `develop` a `main` (cierre de la Parte 7) y el mensaje para el profesor.
