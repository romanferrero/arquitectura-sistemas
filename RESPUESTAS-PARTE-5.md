# Parte 5 — Escalabilidad y mensajería asíncrona

Respuestas sobre cómo se resolvió la Parte 5 en **portafolio-cripto**. El detalle de uso (comandos,
endpoints, claves de Redis) está en el [README](README.md); acá va el razonamiento.

> **Nombres:** se mantuvo la convención del proyecto (todo en español). La cola `report-queue` de la
> letra es `cola-reportes`, y `POST /assets/report` es `POST /api/activos/reporte`.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**Redis cumple tres papeles distintos**, y la diferencia importa cuando se cae:

| Uso | Estructura Redis | Si Redis falla |
| --- | --- | --- |
| Caché de `GET /api/activos/:id` | String + TTL (`SET ... EX`, `GET`) | La API sigue sirviendo desde MySQL |
| Ranking de activos más consultados | Sorted Set (`ZINCRBY`) | Se ignora y se loguea |
| Preferencias de la billetera | Hash (`HSET`, `HGETALL`) | **503**: solo existen ahí |
| Contador de reportes exitosos | String con `INCR` (atómico) | Se loguea; el reporte no se da por fallido |
| Cola de reportes | Estructuras de BullMQ | **503** al pedir o consultar un reporte |

**El trabajo pesado sale del ciclo de la petición.** `POST /api/activos/reporte` no calcula nada:
deja un trabajo en la cola y responde **202** con un id en ~0,2 s. Un **worker** (proceso aparte)
toma el trabajo, genera el "Reporte de Valoración Masiva" (con una demora simulada), lo registra en
la auditoría de MongoDB y deja el resultado en la cola. El cliente consulta cómo va con
`GET /api/reportes/:id` (`en_cola` → `procesando` con su porcentaje → `completado` / `fallido`).

| Decisión | Motivo |
| --- | --- |
| **BullMQ en lugar de Bull** | Bull está en modo mantenimiento (última versión en diciembre de 2024) y sus propios autores recomiendan BullMQ. Los conceptos de la letra (cola, worker, `completed`/`failed`) son los mismos |
| BullMQ con **`ioredis`** y no con el cliente oficial `redis` | Ver la dificultad 2. BullMQ 6 admite ambos, pero el adaptador de `redis` no se comportó bien ante una caída |
| El **worker es otro proceso** (misma imagen, otro comando, otro servicio de Compose) | Se puede detener o reiniciar sin tocar la API (y sumar más workers, que no se probó); y cuando la API corra en cluster (Parte 8) no se multiplican los workers sin querer |
| La API es el **productor** y solo agrega y consulta; no sabe generar reportes | El límite entre responder rápido y trabajar lento queda en el código, no solo en el proceso |
| El id del reporte es un **UUID** y es el id del trabajo | Se encuentra sin guardar nada más y no es adivinable. Un id que no es UUID da 404 sin consultar Redis (si no, `GET /api/reportes/meta` leería la configuración interna de la cola) |
| **3 intentos** con espera creciente (1 s, 2 s) y limpieza de trabajos viejos | Un fallo pasajero de CoinGecko no pierde el reporte; Redis no crece sin límite |
| La cola **falla en el acto** si Redis está caído (`enableOfflineQueue: false`) | Si no, `add` quedaría esperando y la API no podría responder 503. Se midió: falla en 1 ms |
| Todas las dependencias del generador, el procesador y los eventos **entran por parámetro** | Se prueban sin Redis, sin MongoDB, sin red y sin esperar (55 tests nuevos) |
| Redis con **`noeviction`** y AOF | Con la memoria llena rechaza escrituras en vez de borrar claves sin avisar (BullMQ lo exige: no puede perder trabajos), y los datos sobreviven a un reinicio |

## 2. ¿Qué arquitectura utilizaste?

Sigue siendo un monolito modular en capas, pero ahora con **procesamiento asíncrono basado en colas**
(patrón *Producer / Consumer* con **Work Queue**): la API produce trabajos, uno o más workers los
consumen, y Redis hace de intermediario durable. La caché usa el patrón **Cache-Aside**.

```
Cliente → API (productor) → cola-reportes (Redis) → worker → MongoDB (auditoría)
             └─ 202 al instante         └─ el trabajo queda guardado hasta que alguien lo toma
```

La caché es **cache-aside** y no *write-through*: la lógica de leer, guardar y expirar vive en una
fábrica con un Redis falso en los tests; los servicios que escriben solo invalidan.

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Rendimiento / tiempo de respuesta** | Caché con TTL; el reporte se calcula fuera de la petición | `X-Cache: HIT`; 202 en ~0,2 s mientras el reporte tarda 3 s |
| **Escalabilidad** | Worker separado y estado compartido en Redis (no en la memoria de un proceso) | El worker es independiente de la API (sumar más es posible, no se probó); el contador `INCR` es compartido |
| **Disponibilidad / tolerancia a fallos** | La caché es opcional; la cola reintenta; el worker y el productor se reconectan solos | Redis caído: `GET /api/activos` sigue en 200 (MySQL); al volver Redis todo se recupera |
| **Confiabilidad** | La cola es **durable**: un pedido hecho con el worker caído espera y se procesa al volver | Verificado: `en_cola` → worker arriba → `completado` |
| **Observabilidad** | `completed` y `failed` del worker escriben en Winston, con el intento y el motivo | Logs del worker (ver abajo) |
| **Consistencia** | Elegida: la caché puede quedar desactualizada hasta el TTL | Ver abajo |
| **Seguridad** | Redis con contraseña, en `127.0.0.1`, que no queda visible en `docker inspect` | `docker-compose.yml` |
| **Testabilidad** | 242 tests (55 nuevos) sin Redis ni red | `pruebas/` |

**Lo que se ve en el log del worker** (un caso real: CoinGecko respondió 429 por el límite gratuito):

```
[INFO]  WorkerReportes: Generando el reporte ecb5f0c3-… (intento 1)
[ERROR] WorkerReportes: Reporte ecb5f0c3-… falló (intento 1 de 3), se reintenta: La API de precios respondió con el estado 429
[INFO]  WorkerReportes: Generando el reporte ecb5f0c3-… (intento 2)
[ERROR] WorkerReportes: Reporte ecb5f0c3-… falló (intento 2 de 3), se reintenta: …429
[INFO]  WorkerReportes: Generando el reporte ecb5f0c3-… (intento 3)
[ERROR] WorkerReportes: Reporte ecb5f0c3-… falló definitivamente tras 3 intento(s): …429
```

**Dos políticas de auditoría distintas, a propósito.** En el CRUD la auditoría es de *mejor esfuerzo*:
la operación ya ocurrió en MySQL y no se puede deshacer. En el worker, un fallo al registrar **hace
fallar el trabajo**: un reporte se puede volver a generar y la cola ya reintenta, así que es mejor
reintentar que dar por bueno un reporte sin constancia.

> **Lo que se resignó:** consistencia de la caché (ver dificultad 3) y simplicidad: hay dos clientes
> de Redis conviviendo (`redis` para lo que pide la letra, `ioredis` dentro de BullMQ) y un proceso
> más para operar.

## 4. ¿Qué mejoras implementarías en futuras versiones?

- **Autenticación y roles** (Parte 6): hoy cualquiera puede pedir reportes, que son la operación más
  cara de la API. Debería ser solo para el ADMIN.
- **Evitar pedidos duplicados:** varios `POST /reporte` seguidos generan varios reportes iguales.
  Se podría deduplicar por ventana de tiempo, o limitar la cantidad de pedidos por usuario.
- **Reintentos que entiendan el `429`:** la espera de 1–2 s sirve para un fallo pasajero pero no
  para un límite de uso, que pide esperar más (y respetar el `Retry-After`). Mejor aún: guardar las
  cotizaciones en Redis para no pedirlas cada vez.
- **Invalidación robusta de la caché** (Parte 7): hoy depende del TTL si Redis está caído durante un
  `PUT`.
- **Resultado del reporte fuera de la cola:** hoy vive en el resultado del trabajo y se borra a la
  hora; un reporte que importe debería guardarse (MySQL o MongoDB) y la cola solo avisar.
- **Cola de trabajos fallidos (*dead letter*) con alerta**, y un panel (Bull Board) para verlos.
- **Más de un worker** y `concurrency` mayor, midiendo antes el límite del tercero.
- **Tests de integración** con Redis real (Testcontainers): hoy el adaptador de BullMQ y el cliente
  de Redis se verifican a mano y con Newman.

## 5. ¿Qué dificultades encontraste y cómo las resolviste?

1. **El plan estaba desactualizado:** decía que BullMQ "trae `ioredis`". En la versión 6 ya no viene
   incluido; es una dependencia opcional (*peer*). → Se instaló explícitamente y se dejó anotado.
2. **El adaptador del cliente oficial no resistió una caída de Redis.** BullMQ 6 permite usar `redis`
   en lugar de `ioredis`, lo que habría dejado un solo cliente. Se probó con un script contra el Redis
   real: el flujo normal anduvo (progreso, reintentos, cierre en 4 ms), pero al detener Redis **el proceso
   se caía** por un error sin oyente en el adaptador, y aun escuchándolo la recuperación no fue limpia.
   Con `ioredis` el mismo guion pasó completo: `add` falla en 1 ms con Redis caído y, al volver, el
   productor y el worker siguen funcionando solos. → Se eligió `ioredis`. Un worker que no sobrevive a
   una caída de Redis no sirve.
3. **La invalidación de la caché se puede perder.** Con Redis caído, un `PUT` no puede invalidar: al
   volver (los datos persisten por AOF), un `GET` devolvió `cantidad: 1` cuando MySQL ya tenía `3`,
   hasta que venció el TTL. → Se aceptó como costo de una caché de mejor esfuerzo y se mantiene el
   TTL corto; la Parte 7 vuelve sobre esto.
4. **Si Redis está caído, los comandos se encolaban** y la API quedaba colgada. → `disableOfflineQueue`
   en el cliente oficial y `enableOfflineQueue: false` en la cola: fallan en el acto (un `GET` con
   Redis caído respondió en 6 ms; `POST /reporte`, un 503 limpio).
5. **`redis-cli` devuelve 0 aunque la respuesta sea un error.** El healthcheck con una contraseña
   incorrecta habría dado "sano". → Se busca `PONG` en la respuesta.
6. **La contraseña de Redis aparecía en el comando del contenedor** si se interpolaba en el
   `docker-compose.yml`. → Se pasa por variable de entorno y la expande el shell del contenedor.
7. **El límite gratuito de CoinGecko (429) hizo fallar un reporte** en pleno desarrollo. → Es justo el
   caso que la cola cubre: 3 intentos y estado `fallido` con el motivo. También hizo intermitente la
   colección de Postman si se corre muchas veces seguidas; el test ahora informa el motivo.
8. **Dos procesos con la misma imagen.** → El servicio del worker usa la misma imagen que la API con
   otro `command`, y comparte con ella el bloque de variables del compose (ancla YAML).
9. **El cierre ordenado del worker.** `docker compose stop` manda `SIGTERM`; `worker.close()` espera al
   trabajo en curso. Verificado a mitad de un reporte: termina el reporte, lo cuenta y sale con código 0
   (1,7 s). El `stop_grace_period` es de 40 s para dar margen a reportes más largos.

---

## Para discutir en clase

- La API responde **202** y el reporte aún no existe. ¿Qué le aseguramos realmente al cliente? ¿Y si
  Redis pierde el trabajo antes de que el worker lo tome?
- La caché y las preferencias usan el mismo Redis pero se comportan distinto cuando se cae. ¿Cuándo es
  aceptable que una dependencia sea "opcional" y cuándo no?
- Con la cola, un `POST` repetido genera trabajo repetido. ¿Dónde conviene poner la deduplicación: en la
  API, en la cola o en el worker?
- ¿Tiene sentido `INCR` para un contador "global" si hay varios workers? ¿Y si el contador tuviera que
  coincidir exactamente con la cantidad de reportes guardados?
