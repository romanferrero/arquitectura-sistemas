# Tarea domiciliaria — Clase 2 (Tecnología)

Respuestas sobre el proyecto **portafolio-cripto**: API REST en Node + Express 5 + TypeScript
para administrar posiciones en criptoactivos y valuarlas contra una cotización en vivo.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

La decisión de fondo fue tratar el CRUD en memoria como algo **temporal**: el objetivo no era
que funcione, sino que el día que haya base de datos no haya que tocar más que un archivo.

**Las capas** (`rutas → controladores → servicios → datos`, dependencias en una sola dirección):

| Capa | Responsabilidad |
| --- | --- |
| `rutas/` | Único lugar donde se declara el mapeo verbo + path → handler. |
| `controladores/` | Traducen HTTP: leen params/query/body, llaman al servicio, eligen el status. Cero negocio. |
| `servicios/` | Las reglas: símbolo único, id y fechas los pone el servidor, cálculo de ganancia/pérdida. No conocen `req`/`res`. |
| `datos/` | El repositorio. El array en memoria vive acá adentro y ninguna otra capa lo ve. |
| transversales | `config/`, `modelos/`, `validaciones/`, `errores/`, `middlewares/`: los usa cualquier capa. |

**Decisiones concretas:**

- **El estado vive detrás de un repositorio.** Migrar a Postgres es reescribir
  `datos/activosRepositorio.ts`; servicios, controladores y rutas quedan intactos.
- **Un único tipo de error de aplicación.** Cualquier capa lanza `new ErrorApi(404, "…")` y un
  solo middleware lo traduce a JSON: el mapeo error → HTTP queda concentrado en un lugar.
- **Los controladores no llevan try/catch.** Express 5 deriva al manejador de errores tanto las
  excepciones sincrónicas como las promesas rechazadas.
- **Un solo archivo lee `process.env`.** `config/env.ts` valida y congela la config al arrancar
  (fail fast) en vez de reventar más tarde con un `undefined`.
- **Validación en el borde y el body entra como `unknown`.** Se comprueba campo por campo y se
  acumulan *todos* los errores antes de responder.
- **La app se separa del servidor.** `app.ts` arma la aplicación, `servidor.ts` sólo hace
  `listen`: un test puede importar la app sin ocupar un puerto.
- **Casi sin dependencias.** Express es la única de runtime: `fetch`, `randomUUID`, `--env-file`
  y la ejecución directa de `.ts` ya vienen en Node.
- **La API externa es un adaptador aislado.** Todo lo que sabe de CoinGecko está en
  `preciosServicio.ts`.
- **Nombres en español**, consistentes en carpetas, funciones, JSON y mensajes de error.

## 2. ¿Qué arquitectura utilizaste?

Un **monolito modular en capas**, con estilo **REST** hacia afuera y algunos rasgos prestados de
la arquitectura **hexagonal**.

- **En capas:** presentación → aplicación → dominio → persistencia; las dependencias apuntan
  siempre hacia adentro.
- **Monolito modular:** un solo proceso desplegable. Para siete endpoints, microservicios habría
  sido costo puro.
- **REST:** recursos en plural, verbos con su semántica (`PUT` reemplaza el recurso completo),
  códigos de estado que significan algo, `Location` en el 201 y errores con formato uniforme.
- **Rasgos hexagonales:** repositorio y servicio de precios funcionan como adaptadores.

> **Con honestidad:** no es hexagonal de manual. No hay interfaces de puerto ni inyección de
> dependencias; los servicios importan directo el módulo concreto del repositorio. Está la
> separación, falta la inversión.

## 3. ¿Tuviste en cuenta atributos de calidad?

Sí. El que ordenó todas las decisiones fue la **modificabilidad**; los demás entraron donde no
encarecían el ejercicio.

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Modificabilidad** | Alta cohesión, bajo acoplamiento, un punto de cambio por decisión. | `datos/`, `config/env.ts`, `errores/` |
| **Fiabilidad** | Timeout con `AbortSignal.timeout`; fail fast de config; JSON malformado → 400. | `preciosServicio.ts`, `manejadorErrores.ts` |
| **Testabilidad** | App separada del `listen`; validación y cálculo como funciones puras. | `app.ts`, `validaciones/` |
| **Seguridad** | Toda entrada validada; el `id` del body se ignora; sin stack traces al cliente; contenedor sin privilegios y sin `.env`. | `Dockerfile`, `.dockerignore` |
| **Interoperabilidad** | Códigos HTTP correctos (409 duplicado, 502 falla del tercero), errores uniformes, Postman + curl. | `postman/`, `README.md` |
| **Portabilidad** | Configuración por variables de entorno; build multi-stage. | `Dockerfile`, `.env.example` |
| **Observabilidad** | Mínima: `/salud` y log completo del error en el servidor. | `app.ts` |

> **Lo que se resignó a propósito:** durabilidad y escalabilidad. El estado en memoria se pierde
> en cada reinicio y no permite correr dos instancias (cada una tendría su propio portafolio).

## 4. ¿Qué mejoras implementarías en futuras versiones?

**Horizonte 1 — cimientos (lo que ya duele)**
- Persistencia real (Postgres + Prisma/Drizzle) implementando la misma firma del repositorio, con migraciones.
- Tests automatizados: unitarios de validación y servicio, integración con `node:test` + `supertest`.
- Interfaces de puerto e inyección de dependencias, para sustituir repositorio y precios por dobles.
- Esquemas con Zod: una sola fuente de verdad para tipo y validación.

**Horizonte 2 — producto**
- Endpoint de resumen del portafolio (valor total, costo total, rendimiento agregado).
- Caché de precios con TTL corto y consulta en lote: menos latencia y sin chocar el rate limit.
- Resiliencia: reintentos con backoff, circuit breaker y respuesta degradada con el último precio conocido.
- Historial de operaciones (compras/ventas) con costo promedio ponderado, en vez de una posición por símbolo.
- Paginación, orden y filtros en el listado.

**Horizonte 3 — producción**
- Autenticación y multiusuario (hoy el portafolio es uno solo y global).
- Endurecimiento HTTP: `helmet`, CORS explícito, rate limiting, límite de tamaño del body.
- Observabilidad: logs estructurados con id de correlación, métricas, `/salud` dividido en liveness y readiness.
- OpenAPI generado desde los esquemas y versionado de la API (`/api/v1`).
- Aritmética de dinero en decimal o enteros, no en `float`.
- CI con `tsc --noEmit`, lint y tests; `docker compose` para levantar API y base juntas.

## 5. ¿Qué dificultades encontraste y cómo las resolviste?

1. **Correr TypeScript sin transpilador externo.** Node borra los tipos pero no entiende sintaxis
   que no sea puramente de tipos (`enum`, propiedades en el constructor).
   → `erasableSyntaxOnly`, para que avise el compilador y no el runtime.
2. **Los imports con extensión `.ts` no existen después de compilar.** En ESM la extensión es
   obligatoria, pero en `dist/` los archivos son `.js`.
   → `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`: se escribe `.ts`, se ejecuta `.js`.
3. **CoinGecko no conoce los símbolos.** Identifica por id interno (`bitcoin`), no por `BTC`, y
   `/coins/list` descarga ~15.000 monedas sólo para traducir un identificador.
   → Mapa estático de los 12 símbolos soportados y un 404 explícito que los enumera.
4. **Tipar una respuesta externa sin `any`.** `response.json()` devuelve `unknown`.
   → Función que navega `{ bitcoin: { usd: 63500.12 } }` comprobando cada nivel; si algo no cuadra, 502.
5. **Elegir el código HTTP de cada falla.** Criterio adoptado: 502 (no 500) si falla la API de
   precios, porque el problema es de un tercero; 409 al repetir un símbolo, porque es conflicto de
   estado; 404 distinguiendo "no existe el activo" de "no existe la ruta"; 400 con la lista completa
   de campos inválidos.
6. **Un JSON mal escrito devolvía 500.** `express.json()` lanza un `SyntaxError` que caía en el
   catch genérico. → Detectarlo en el manejador de errores y responder 400.
7. **Una llamada externa lenta bloqueaba la request.** `fetch` no tiene timeout por defecto.
   → `AbortSignal.timeout(TIMEOUT_MS)`, configurable por entorno.
8. **El modo estricto obligó a repensar accesos "obvios".** Con `noUncheckedIndexedAccess` todo
   acceso por índice puede ser `undefined`. → Tipar los params (`Request<{ id: string }>`) y
   comprobar de verdad lo que viene de afuera.
9. **Dónde poner la validación.** En el controlador era lo cómodo, pero ata la regla a HTTP.
   → El controlador pasa el body tal cual y el servicio valida.
10. **El `.env` y el contenedor.** Copiarlo a la imagen la ata a un entorno y mete secretos en una
    capa. → `.dockerignore`, build multi-stage y config inyectada con `docker run --env-file`.

---

## Para discutir en clase

- ¿Cuándo conviene pagar el costo de las interfaces de puerto y la inyección de dependencias? Acá
  parece ceremonia, pero es justo lo que impide testear sin salir a internet.
- ¿502 o 503 cuando el proveedor de precios no responde? ¿Tiene sentido devolver un precio viejo
  con marca de tiempo en lugar de un error?
- La validación quedó escrita a mano para no sumar dependencias. ¿Se justifica igual traer una
  librería de esquemas desde el día uno?
