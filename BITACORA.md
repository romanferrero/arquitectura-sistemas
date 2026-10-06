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
