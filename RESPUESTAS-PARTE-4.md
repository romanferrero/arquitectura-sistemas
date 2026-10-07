# Parte 4 — Persistencia y gestión de datos real

Respuestas sobre cómo se resolvió la Parte 4 en **portafolio-cripto**. El detalle de uso (comandos,
endpoints, esquema) está en el [README](README.md); acá va el razonamiento.

> La entidad `User` que la letra deja como opcional **no se implementó**: sin autenticación no hay
> forma real de saber quién es el dueño de cada activo, y cambiaría el contrato de la API (símbolo
> único *por usuario*, un `userId` en cada pedido). Queda como mejora.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**Cada dato, en el motor que mejor le calza.** El `Activo` tiene estructura fija, reglas de
integridad y se consulta por clave: va a **MySQL** (Sequelize). La auditoría crece rápido y cada
registro tiene una forma distinta según la operación: va a **MongoDB** (Mongoose).

| Decisión | Motivo |
| --- | --- |
| El esquema de MySQL cambia **solo por migraciones** (Umzug), nunca con `sync()` | Cambios versionados, reversibles (`up`/`down`) y repetibles |
| Las reglas también viven en la base: `UNIQUE` en el símbolo y `CHECK` de valores positivos | Aunque otra aplicación escriba directo, MySQL las hace cumplir |
| El símbolo único lo decide la restricción `UNIQUE`, no una búsqueda previa | "Buscar y después guardar" no es seguro: 5 `POST` simultáneos del mismo símbolo → 1 da 201 y 4 dan 409 |
| El repositorio **relee la fila** después de escribir | MySQL redondea los `DECIMAL` en silencio (`98.456` → `98.46`); el `POST` y el `GET` tienen que coincidir |
| Mapeo fila ↔ `Activo` en **funciones puras** | Concentra las diferencias de representación y se prueba sin base de datos |
| La auditoría es de **mejor esfuerzo** | No hay transacción entre las dos bases; ver la pregunta 3 |
| La API es un servicio más del `docker-compose.yml` y espera a que las bases estén `healthy` | Un solo comando levanta todo; no arranca contra una base que todavía no atiende |
| `config/env.ts` sigue siendo el único archivo que lee `process.env` | Las variables nuevas se validan ahí con *fail fast* |

## 2. ¿Qué arquitectura utilizaste?

Sigue siendo un **monolito modular en capas** con estilo REST; lo nuevo es la **persistencia
políglota** (dos motores) detrás del patrón **Repository**.

> **Con honestidad:** la letra pide mostrar "el poder de la Arquitectura en Capas", con servicios y
> controladores sin cambios significativos. Se cumplió en lo esencial: reescribir el acceso a datos
> fue reescribir `activosRepositorio.ts`, y el controlador solo sumó `async`/`await`. Pero **no fue
> cero cambios**: el servicio tuvo que pasar a asíncrono, traducir el error de símbolo duplicado y
> disparar la auditoría. Es el costo real de pasar de un array a una red. Tampoco hay interfaces de
> puerto para los repositorios (los servicios importan el módulo concreto); la excepción es el
> servicio de auditoría, que recibe su repositorio por parámetro.

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Durabilidad** (nueva) | Datos en volúmenes de Docker; sobreviven a `docker compose down` y a reiniciar la API | `docker-compose.yml` |
| **Integridad** | `UNIQUE`, `CHECK`, `DECIMAL` en lugar de `FLOAT`, rangos validados de antemano | `001-crear-activos.ts`, `modelos/limites.ts` |
| **Disponibilidad / tolerancia a fallos** | Con MongoDB caído, las operaciones sobre activos siguen funcionando; la consulta de historial responde 503 | `crearServicioAuditoria.ts` |
| **Consistencia** | Elegida a conciencia: eventual y de mejor esfuerzo entre las dos bases | ver abajo |
| **Portabilidad** | Todo el entorno con `docker compose up`; configuración por variables | `docker-compose.yml`, `.env.example` |
| **Testabilidad** | Repositorio, logger y tiempo máximo inyectados en la auditoría; mapeos puros | `pruebas/` (158 tests) |
| **Seguridad** | Puertos publicados solo en `127.0.0.1`; `.env` fuera de la imagen; el ORM parametriza las consultas; contenedor sin privilegios | `docker-compose.yml`, `Dockerfile` |

**La decisión de fondo: consistencia entre dos bases.** Escribir en MySQL y en MongoDB son dos
operaciones independientes. Si MySQL confirma y MongoDB falla, no se puede deshacer lo primero.
Había dos caminos: fallarle al cliente (que reintentaría y duplicaría la operación) o responder
bien y dejar el error en el log. Se eligió lo segundo, con un tope de **2 segundos** para que una
caída de Mongo no frene cada escritura. Se probó apagando MongoDB con la API corriendo: el `POST`
responde 201 y el activo queda en MySQL, y al volver Mongo la API se reconecta sola.

> **Lo que se resignó:** la garantía de que *toda* operación tenga su registro. Mientras Mongo está
> caído, las operaciones quedan sin auditoría. También escalabilidad: las migraciones se aplican al
> arrancar la API, lo que es cómodo con una instancia pero no con varias arrancando a la vez.

## 4. ¿Qué mejoras implementarías en futuras versiones?

- **Transactional Outbox:** guardar el evento de auditoría en MySQL dentro de la misma transacción
  que el cambio, y copiarlo a MongoDB después. Elimina los registros perdidos.
- **Entidad `User`** con autenticación, y el activo perteneciente a un usuario.
- **Usuario de aplicación en MongoDB** con permisos limitados (hoy se usa el root, que la guía del
  ejemplo marca como válido solo para el aprendizaje), y credenciales fuera del `.env`.
- **Tests de integración** contra bases reales (por ejemplo con Testcontainers): hoy el repositorio
  de MySQL y el de MongoDB se verifican a mano y con Newman, no en la suite automática.
- **Paso de migración separado** del arranque de la API, para correr con varias instancias.
- **Retención de la auditoría** (índice TTL) y paginación real con cursor.
- **Aritmética decimal exacta:** los `DECIMAL` se convierten a `number` al leerlos; para montos muy
  grandes o muchas cuentas convendría una librería de decimales.
- **`/salud` con estado de las bases** (*readiness*), no solo "el proceso está vivo".

## 5. ¿Qué dificultades encontraste y cómo las resolviste?

1. **El puerto de MongoDB estaba ocupado** por un MongoDB instalado en Windows. → El contenedor sale
   por el 27018 en el `.env` local; no se toca el servicio del sistema.
2. **Los `DECIMAL` llegan como texto** y MySQL **redondea en silencio**. → Mapeo explícito y releer la
   fila tras escribir, para que la respuesta diga lo que realmente se guardó.
3. **Un valor positivo pero diminuto da un 500.** `cantidad: 1e-9` se redondea a 0 y viola el `CHECK`.
   → Los rangos que entran en las columnas se validan antes, y ahora da un 400.
4. **Carrera entre comprobar y guardar.** Con una base real, dos pedidos simultáneos pasan la
   búsqueda a la vez. → Se confía en la restricción `UNIQUE` y el repositorio traduce su error.
5. **Migraciones con módulos ES y TypeScript sin transpilar.** `sequelize-cli` es CommonJS. → Umzug
   programático, migraciones en `.ts` y una lista explícita (sin glob) que sirve igual en `src/` y
   en `dist/`.
6. **Los errores de conexión llegaban con el mensaje vacío.** → Un helper que muestra el nombre y el
   código (`SequelizeConnectionRefusedError: ECONNREFUSED`).
7. **La imagen de Docker no se podía construir:** `npm ci` pedía dependencias opcionales de Jest que
   el lock de Windows no tenía. Estuvo oculto desde que se agregó Jest porque no se reconstruía la
   imagen. → Se fijaron esas dependencias; ahora se construye bien.
8. **El healthcheck de MySQL daba "sano" demasiado pronto.** Con un volumen nuevo, la imagen arranca
   un servidor temporal solo por socket, y `mysqladmin ping -h localhost` le contestaba "sano" a ese
   servidor. La API se conectaba antes de tiempo, fallaba, y solo andaba gracias a `restart`. →
   El healthcheck prueba por TCP (`127.0.0.1`). Tres arranques desde cero seguidos: 0 reinicios. El
   ejemplo del profesor tiene el mismo defecto latente.
9. **Probar el cierre ordenado en Windows.** `kill -INT` no entrega la señal a un proceso nativo. →
   Se verificó con `docker stop`, que manda un SIGTERM real: la API cierra en 1 segundo con código 0.
10. **Una caída de MongoDB frenaba cada escritura 5 segundos** (el tiempo que el driver tarda en
    rendirse). → Tope de 2 segundos para registrar la auditoría.
11. **`npm audit` pasó de 0 a 6 avisos moderados** al agregar `umzug` y `sequelize`. Son transitivos
    (afectan una herramienta de línea de comandos que no usamos y un parámetro que Sequelize no
    usa) y los "arreglos" instalan versiones de hace años. → Se aceptó y quedó documentado.

---

## Para discutir en clase

- Se eligió que la auditoría **no** haga fallar la operación. ¿En un sistema financiero real, la
  trazabilidad completa justificaría lo contrario, aun a costa de disponibilidad?
- ¿Cuándo conviene pagar la complejidad de un Transactional Outbox frente a un simple log de errores?
- El healthcheck de la guía funciona la mayoría de las veces y falla solo al crear el volumen.
  ¿Cómo se detectan defectos así antes de llegar a producción?
