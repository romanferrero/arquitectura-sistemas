# Parte 8 — Escalabilidad horizontal con PM2, salud y pruebas de carga

Respuestas sobre cómo se resolvió la Parte 8 en **portafolio-cripto**. El detalle de uso (la configuración de PM2, `/salud`, el cierre
ordenado, el monitor de reinicios y cómo correr la prueba de carga) está en el [README](README.md), secciones *PM2, salud y cierre
ordenado* y *Pruebas de carga*; acá va el razonamiento y lo que se midió.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**La API pasó de un proceso a un cluster de procesos idénticos detrás de un mismo puerto, y todo lo que antes vivía en la memoria de un proceso
vive ahora fuera de él.** Un proceso de Node usa un solo núcleo; PM2 en modo cluster levanta varios y reparte las conexiones. Eso solo es seguro
si ninguna instancia guarda estado que las otras necesiten, y la Parte 5 a la 7 ya lo habían resuelto: el token JWT no guarda sesión, la caché, las
preferencias, el modo pánico y el canal de eventos están en Redis, y los datos en MySQL.

| Decisión | Motivo |
| --- | --- |
| **La API en cluster (`instances: "max"`); el worker y los dos suscriptores, una sola instancia cada uno** | Con Pub/Sub cada copia de un suscriptor recibiría **todos** los eventos y el trabajo se duplicaría (las notificaciones, no idempotentes, saldrían repetidas). La cola de BullMQ sí admitiría varios workers, pero no hace falta multiplicarlo con la API |
| `ecosystem.config.cjs` (y no `.js`) | El proyecto es `"type": "module"` y PM2 lee ese archivo con `require` |
| `wait_ready` + `process.send("ready")` **después** de conectar las tres bases, precargar las claves de Auth0 y escuchar | PM2 no manda tráfico a una instancia que todavía no puede atenderlo. El costo: las instancias arrancan de a una (unos 6 s cada una) |
| `kill_timeout` **mayor** que el tiempo que la API espera a los pedidos en curso (12 s contra 10 s) | Para que el cierre ordenado alcance a terminar antes del `SIGKILL` |
| **Cierre ordenado** en todos los procesos (`SIGINT` de PM2, `SIGTERM` de Docker): dejar de aceptar, terminar lo que hay, cerrar conexiones | Un reinicio o un despliegue no tiene que cortar un pedido a la mitad ni dejar un reporte colgado |
| `GET /salud` comprueba **MySQL, MongoDB y Redis en paralelo**, cada una con tope de 2 s; 200 o 503; **sin el detalle del error** en la respuesta | Es público (lo usan Docker y los monitores, que no tienen token): un mensaje de error mostraría hosts y puertos internos. El detalle va al log |
| Header **`X-Instancia`** en todas las respuestas | Es la única forma de *ver* el reparto de la carga y de saber qué instancia atendió un pedido que falló |
| Las **migraciones** pasaron a un servicio de una sola ejecución (`migraciones`) del que dependen los demás | Con 16 instancias arrancando a la vez no pueden migrar todas |
| **Monitor de reinicios** que lee el **contador** de reinicios de PM2 cada 5 s (ventana deslizante, función pura con tests) y deja un log `[CRÍTICO]` si una instancia reinicia más de 5 veces en 60 s | El contador cubre todos los motivos de reinicio (caída, `max_memory_restart`, `pm2 restart`) sin depender de no perder un evento del bus |
| **`max_restarts: 20`**, no 5 | Con 5, PM2 detendría el ciclo de caídas antes de que el monitor llegara a ver más de 5 en un minuto |
| **`max_memory_restart: 512M`** | Se midió: una instancia que atiende todo el tráfico se estabiliza en ~330 MB. El primer valor (300M) reiniciaba una instancia sana (ver sección 4). Sigue protegiendo de una fuga real |
| `PM2_INSTANCES` por defecto `max` en el compose, pero **se recomienda 4** en esta máquina | `max` es lo que pide la letra; las mediciones muestran que acá más de 4 no ayuda e incluso daña |
| La prueba de carga **no** se declara aprobada ni el reload "sin cortes" donde no lo está | Se documentan los números reales, incluidos los malos |

## 2. ¿Qué arquitectura utilizaste?

El monolito modular en capas de las partes anteriores, ahora **escalado horizontalmente**: varias instancias idénticas y sin estado de la API
detrás de un balanceo que hace PM2, con el estado compartido en Redis y MySQL, y el trabajo asíncrono en procesos aparte.

```
                          ┌────────────── contenedor `api` (pm2-runtime) ───────────────┐
 cliente ──► :3000 ──────►│ master de PM2 ──► api #0 · api #1 · … · api #N  (cluster)   │──► MySQL · Redis · MongoDB
                          │ monitor-reinicios (lee el contador de PM2, log [CRÍTICO])    │
                          └──────────────────────────────────────────────────────────────┘
 contenedor `worker-reportes` (1 instancia) ──► cola BullMQ        contenedores `suscriptor-*` (1 instancia c/u) ◄── Pub/Sub
 contenedor `migraciones` (una sola vez, antes que todo)
```

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Escalabilidad** | Cluster de procesos sin estado; el estado compartido fuera del proceso | `X-Instancia` reparte el tráfico entre todas las instancias (400 pedidos a `/salud`, 23 a 26 por instancia) |
| **Disponibilidad** | `autorestart`, `max_memory_restart`, `restart: unless-stopped`; si una instancia cae, las otras siguen | `kill -9` de una instancia: PM2 la levantó en 2 a 9 s |
| **Observabilidad** | `/salud` con el estado de las tres bases y el número de instancia; log `[CRÍTICO]`; `X-Instancia`; `pm2 monit`/`jlist` | Siete `kill -9` seguidos dispararon el log crítico |
| **Tolerancia a fallas / cierre limpio** | Cierre ordenado con tope; `uncaughtException` y `unhandledRejection` cierran y salen con error para que PM2 reinicie limpio | `docker compose stop worker-reportes` con un reporte en curso: lo termina y sale con código 0. `stop api` con 16 instancias: 5 s, salida 0 |
| **Rendimiento** | Más núcleos aprovechados; lecturas desde Redis | Tabla de la sección 4: de 1 a 4 instancias, +49 % de throughput |
| **Mantenibilidad** | La lógica del monitor (ventana deslizante) y del health check son fábricas con todo por parámetro | 21 tests nuevos (520 en total) sin PM2 ni red |
| **Seguridad** | `/salud` público pero sin detalle de errores; el header `X-Instancia` solo expone un número | El detalle de un fallo va solo al log |

## 4. Prueba de carga: una instancia contra el cluster

**Qué se midió.** k6 con 100 usuarios virtuales en paralelo durante 30 s: 80 leen `GET /api/activos/:id` (sale de Redis) y 20 hacen
`POST` + `DELETE` en USD (pipeline, MySQL y evento). Sin pausa entre pedidos: es una prueba de **estrés**, no de uso normal. Se corrió contra 1, 4,
8 y 16 instancias, con un calentamiento de 10 s antes de cada corrida y verificando que estuvieran **todas** las instancias `online` (`up --wait`
da la API por lista con la primera). Umbrales: p95 < 500 ms, fallas < 1 %, 0 respuestas 5xx.

| Instancias | req/s | p50 | p95 | p99 | Lectura (p50 / p95 / p99) | Escritura (p50 / p95 / p99) | CPU de la API | Memoria de la API |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2.695 | 29 ms | 78 ms | 119 ms | 28 / 49 / 62 ms | 81 / 136 / 172 ms | 133 % | 345 MiB |
| 4 | 4.015 | 17 ms | 55 ms | 122 ms | 16 / 40 / 94 ms | 46 / 119 / 264 ms | 633 % | 1,0 GiB |
| 8 | 4.274 | 13 ms | 54 ms | 159 ms | 12 / 42 / 111 ms | 42 / 155 / 457 ms | 836 % | 1,8 GiB |
| 16 | **374** | 17 ms | 434 ms | 1,59 s | 15 / 367 ms / 1,19 s | 98 ms / **1,54 s** / 4,31 s | 348 % | 2,1 GiB |

Todas con **0 respuestas 5xx**, 100 % de los chequeos, 99,8 a 99,96 % de las lecturas servidas por Redis (`X-Cache: HIT`) y las
respuestas repartidas entre todas las instancias (se ve en los contadores `instancia_N`). La CPU y la memoria son una captura de `docker stats` a
mitad de la corrida. Los umbrales de p95 < 500 ms se cumplen con 1, 4 y 8 instancias; **con 16 no se cumple el de escritura**.

**Interpretación.**

- **De 1 a 4 instancias la ganancia es real pero lejos de lineal:** +49 % de throughput y p95 de 78 a 55 ms. Con 4 se usa el 633 % de CPU, no el 400 %: ese contenedor tiene además el
  proceso maestro de PM2 y el monitor, y cada proceso de Node usa hilos propios (recolector de basura y otros); no se midió cuánto aporta cada uno.
- **De 4 a 8 casi no hay ganancia (+6 %), y con 16 hay un colapso.** Es la parte menos intuitiva: "más procesos" no es "más rendimiento" cuando los procesos
  **comparten los mismos núcleos y la misma memoria** con el generador de carga y con las bases. Durante la prueba k6 llegó al 230 % de CPU, MongoDB al 125 % (cada
  escritura se audita) y MySQL al 55 %; con 16 instancias la API sola ocupó entre 1,4 y 2,1 GB de una VM de 3,7 GB. Además, 16 instancias son 80 conexiones a
  MySQL y 16 veces el trabajo de arranque, de reconexión y de recolección de basura.
- **Esto es una medida de esta máquina, no una propiedad de PM2.** En un servidor donde la API tenga sus propios núcleos y la base esté aparte, el escalado seguiría
  más allá de 4. Lo que la prueba muestra es **dónde está el cuello**: no en el código de la API (con 1 sola instancia, p95 de 78 ms con 100 usuarios) sino en los recursos
  compartidos.
- **La lectura es barata; la escritura es lo que se degrada.** En todas las corridas las lecturas (Redis) mantienen un p50 de 12 a 29 ms; la escritura es entre 3 y 6 veces más lenta
  (pipeline, MySQL, evento y, por el suscriptor, la auditoría en MongoDB) y es la que cruza el umbral cuando falta recurso.
- **CQRS rinde:** con el 90 % del tráfico siendo lectura, MySQL quedó en 20 a 55 % de CPU con miles de pedidos por segundo.

**Lo que salió mal, y qué se aprendió (todo medido, no supuesto).**

1. **Con 16 instancias el kernel de la VM mató a MySQL por falta de memoria** (`Out of memory: Killed process (mysqld)` en `dmesg`, dos veces). Docker perdió el rastro de ese proceso: el contenedor
   quedó en bucle `Restarting (137)` y un `mysqld` huérfano seguía vivo bloqueando el archivo de datos (`Unable to lock ./ibdata1`); se resolvió cerrándolo con `SIGTERM` y levantando
   MySQL por el compose. Después, `CHECK TABLE activos` dio OK. La API en bucle de reconexión no ayudaba. Moraleja: **el tope de memoria de la máquina es un parámetro de diseño**, y `max` no lo respeta.
2. **Con 1 instancia, PM2 la reinició por `max_memory_restart` (300M) en plena carga** y fallaron 7 pedidos (de ~68.000). No era una fuga: se midió la memoria cada 4 s durante 90 s y sube de 208 a
   ~323 MB y se queda ahí. El tope era más bajo que el techo normal de una instancia con todo el tráfico. Se subió a 512M.
3. **Mis primeras corridas de 4 y de 1 instancia estaban mal medidas:** `docker compose run` recreó la API con la configuración por defecto (16) antes de medir. Se detectó porque el
   contador `instancia_N` mostraba instancias de más. Se corrigió con `--no-deps` y esperando a que estén todas `online`, y se repitió todo.
4. **Otro proyecto de Docker del estudiante corría en paralelo** (cinco contenedores, con MongoDB al 85–97 % de CPU en algunas capturas) y alteraba las medidas; se detuvo (sin borrarlo) y
   se repitió.
5. **El rendimiento con 16 instancias no es reproducible:** dos corridas previas (con el límite en 300M y el otro proyecto corriendo) dieron 1.300 a 1.900 req/s y p95 de ~145 ms, sin errores; la última, con el
   stack limpio, 374 req/s. Tres cosas distintas pasaron con 16 (bien, estancada, OOM de MySQL): lo único que se puede afirmar es que **en esta máquina 16 instancias bajo carga están al
   borde del límite de memoria y el resultado depende de cuánta tenga libre en ese momento**. No se pudo determinar la causa exacta de la corrida estancada (la hipótesis es presión de memoria/intercambio).

**Limitaciones de la medición:** una sola corrida de 30 s por configuración (sin repeticiones ni intervalo de confianza); el generador de carga corre en la misma máquina y compite por los
núcleos; las 100 conexiones sin pausa son un caso extremo, no un patrón de uso; el cluster de PM2 reparte por turnos, no por carga (por eso algunas instancias atienden más que otras). Las capturas
de `pm2 monit` se sacan a mano (es interactivo): *pendiente del estudiante*; como respaldo quedan `pm2 jlist` y `docker stats` de cada corrida (los valores de CPU y memoria de la tabla).

## 5. ¿Qué mejoras implementarías en futuras versiones?

- **Fijar límites de memoria por contenedor** (`mem_limit`) y un `oom_score_adj` bajo para MySQL: que ante falta de memoria el kernel (o Docker) elija a la API y no a la base.
- **Escalar fuera de la máquina**: la API en su propio host (o varias réplicas detrás de un balanceador) y las bases aparte; es donde el cluster dejaría de competir por recursos.
- **Balanceo real** (Nginx, un *ingress* o un balanceador de nube) en lugar del reparto por turnos de PM2, con *health checks* por instancia y `least_conn`.
- **Compartir las claves de Auth0 (JWKS) por Redis**, o seguir usando las viejas si la descarga falla: con varias instancias arrancando a la vez es la causa de los 503 sueltos en un `reload`.
- **Arranque en paralelo**: con `wait_ready` las instancias arrancan una por una (~2 min para 16); un `listen_timeout` más corto o arrancar en tandas lo acortaría.
- **Métricas de verdad** (Prometheus + Grafana, o `k6` hacia InfluxDB) en lugar de capturas de `pm2 monit`: series en el tiempo de CPU, memoria, latencias y reinicios.
- **Una prueba de carga en CI** con un umbral (p95, fallas) que rompa el *build* si se degrada; y repeticiones con intervalo de confianza.
- **Un reload sin pérdida con muchas instancias**: hoy con 16 hubo entre 0,5 y 1 % de pedidos fallidos (CPU saturada, Auth0, MySQL); haría falta reiniciar por tandas y esperar a la salud de cada una.
- **Mover la auditoría a un canal con persistencia** (Streams o una cola), para no depender de que el suscriptor esté vivo (ver Parte 7); bajaría también la carga de MongoDB en la escritura.

## 6. ¿Qué dificultades encontraste y cómo las resolviste?

1. **Cómo detectar "más de 5 reinicios en un minuto".** Un evento por reinicio puede perderse; el contador acumulado de PM2 no. → El monitor lee `restart_time` con `pm2.list` cada 5 s y calcula la ventana deslizante (función pura, con tests).
2. **PM2 detenía el ciclo de caídas antes de que el monitor lo viera** (`max_restarts: 5` por defecto). → `max_restarts: 20` a propósito.
3. **Un `reload` con tráfico daba 503 en las instancias nuevas**: la primera petición autenticada esperaba la descarga de las claves de Auth0. → Se precargan antes del `ready`, con reintentos. Queda un residuo (Auth0 que responde mal cuando varias instancias las bajan a la vez), documentado.
4. **Medir mal sin darme cuenta** (`docker compose run` recreando la API, el otro proyecto de Docker, el tope de 300M). → Cada corrida verifica el número de instancias online antes y después, los contadores por instancia y los reinicios de PM2; y los resultados dudosos se descartaron y repitieron.
5. **MySQL en bucle `Restarting (137)` tras el OOM.** → Se diagnosticó con `docker events`, `dmesg` y arrancando MySQL en primer plano (el error real: `Unable to lock ./ibdata1`), y se cerró el proceso huérfano.
6. **El `docker compose up --wait` no espera a todas las instancias**, solo a la primera. → Un bucle que cuenta las instancias `online` con `pm2 jlist`.
7. **La memoria de la máquina** (8 GB, VM de Docker de 3,7 GB) condiciona todo: Jest en banda, el cluster, la prueba. Es el hilo común de las dificultades de estas dos partes.

---

## Para discutir en clase

- Con 16 instancias el sistema **empeoró** respecto de 4. ¿Qué habría que cambiar en la infraestructura (no en el código) para que escalara hasta `max`? ¿Cuánto cuesta cada instancia extra?
- La letra pide `instances: "max"`. En una máquina chica, ¿es mejor *fallar rápido* por falta de memoria o limitar el número de instancias automáticamente según la memoria disponible?
- `max_memory_restart` protege de una fuga pero, mal calibrado, **reinicia procesos sanos**. ¿Cómo se elige el valor? ¿Y qué alternativa hay (alertar en lugar de reiniciar)?
- El monitor de reinicios mide un contador cada 5 s. ¿Qué se pierde frente a escuchar eventos, y qué se gana?
- Con el cluster, `/salud` responde por **una** instancia. ¿Qué significa "sano" para el servicio completo? ¿Y para el balanceador?
