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

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el informado para la sesión 1; no se
  volvió a confirmar).
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

- **Modelo / esfuerzo:** Sonnet 5.5 · esfuerzo alto (el informado para la sesión 1; no se
  volvió a confirmar).
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
  `develop` a `main` con el tag `parte-3`.
- `tasasServicio` y `preciosServicio` siguen sin test unitario (importan `config/env.ts`).
