# portafolio-cripto

API REST de un portafolio de criptoactivos (Node 24 · Express 5 · TypeScript 7), ejercicio
del curso de Arquitectura de Software. Se trabaja por sesiones siguiendo [PLAN.md](PLAN.md).

## Cómo se trabaja

- Las letras del curso y los ejemplos del profesor están en `Contextos/`.
- Al empezar una sesión: leer `PLAN.md` (sección Estado) y la última entrada de `BITACORA.md`.
- Al cerrar una sesión: marcar el avance en `PLAN.md` y agregar una entrada en
  `BITACORA.md` (modelo, esfuerzo, modo, skills, decisiones y quién las tomó, verificación).
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
- Tests en `pruebas/`, importando `describe`/`test`/`expect` desde `@jest/globals`.
