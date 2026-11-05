# Parte 7 — CQRS y mensajería con Redis Pub/Sub

Respuestas sobre cómo se resolvió la Parte 7 (el PDF la titula "Parte 6", es un error de la letra) en **portafolio-cripto**. El
detalle de uso (el contrato del evento, los suscriptores, el reto, las medidas) está en el [README](README.md), sección *CQRS:
comandos, consultas y eventos*; acá va el razonamiento.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**Se separó escribir de leer, y lo que se deriva de una escritura se hace por eventos.** Un comando valida, persiste en MySQL y
publica un evento; una consulta lee de Redis y solo va a MySQL si el dato no está; y dos procesos aparte, los suscriptores,
reaccionan al evento.

| Decisión | Motivo |
| --- | --- |
| **Comandos y consultas en servicios distintos**, cada uno una fábrica con todo por parámetro | Cada lado se prueba sin MySQL, Redis ni red, y se puede cambiar uno sin tocar el otro |
| El comando **solo valida, persiste y publica**: no toca la caché ni la auditoría | Es lo que pide la letra. La API deja de conocer a MongoDB y a la caché; quién reacciona al evento es problema de los suscriptores |
| El evento se publica **después** de que MySQL confirma, y publicar es **de mejor esfuerzo** | Nunca se anuncia algo que no ocurrió; y MySQL ya confirmó, así que fallarle al cliente por un evento no tiene sentido |
| El evento tiene un **contrato versionado** (Zod) y se valida **al publicar y al recibir** | Publicador y suscriptores no se conocen, pero comparten esa forma. El canal no garantiza nada de quien escribe en él |
| **Dos suscriptores, procesos aparte** (misma imagen, otro comando) | Uno por tarea: se pueden parar, reiniciar o escalar por separado, y si uno falla el otro sigue. Es el molde del ejemplo del profesor |
| **Dos conexiones a Redis** por suscriptor (`subscribe` y `duplicate()`) | Una conexión suscripta no puede ejecutar otros comandos (lo advierte la letra); los datos van por la segunda |
| El suscriptor **invalida** la caché en vez de escribir el dato del evento | Dos eventos del mismo activo pueden llegar en otro orden del que ocurrieron (los publican distintas instancias de la API): escribir uno viejo dejaría la caché mal hasta el TTL. Invalidar nunca deja un dato equivocado: la próxima lectura va a MySQL |
| La **auditoría de un evento es idempotente** (índice único parcial en `idEvento`) | Si el mismo evento llega dos veces, no se duplica el historial. Parcial, para que los registros viejos y los reportes (sin `idEvento`) no choquen |
| Los eventos se procesan **de a uno y en orden**; uno inválido o que falla no frena a los demás | Un `ACTIVO_ACTUALIZADO` no se aplica antes que el `ACTIVO_CREADO` anterior. Pub/Sub no reenvía, así que reintentar no es posible: se deja el error en el log y se sigue |
| La **Whale Alert** usa el límite de cada usuario (preferencia) y, si no hay, el umbral general | Es lo que el usuario configuró; con Redis caído rige el umbral general: una alerta con el límite por defecto vale más que ninguna |
| La regla de la alerta (`monto > umbral`) es **una sola función** compartida con el análisis de riesgo | Las dos partes del sistema tienen que hablar de lo mismo |
| El WARN del publicador cuando hay **0 receptores** | Ahora la caché y la auditoría dependen de que alguien escuche: un evento que no le llegó a nadie ya no es ruido sino una operación sin proyectar |

## 2. ¿Qué arquitectura utilizaste?

Sigue siendo un monolito modular en capas para el camino síncrono, y se le suma una **arquitectura orientada a eventos** para lo
asíncrono: **CQRS** (modelos de escritura y de lectura separados, con *consistencia eventual* entre ellos) y **Publicador /
Suscriptor** sobre Redis. La API es el *publisher*; los suscriptores son *consumers* independientes del mismo canal.

```
                 ┌── COMANDOS ──► MySQL (escritura, fuente de verdad) ──► PUBLISH activos-actualizaciones
 Controlador ────┤                                                              │
                 │                                                              ├──► suscriptor de PROYECCIONES ──► invalida la caché · cuenta · audita (MongoDB)
                 │                                                              └──► suscriptor de NOTIFICACIONES ──► Whale Alert
                 └── CONSULTAS ──► Redis (modelo de lectura) ──(si no está)──► MySQL
```

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Rendimiento** | El modelo de lectura sale de Redis: la base principal no recibe las lecturas | 100 lecturas de la lista: **0** consultas `SELECT` a MySQL con Redis y **100** sin Redis (`Com_select`) |
| **Escalabilidad** | Lecturas desacopladas de la escritura; suscriptores escalables por separado | Procesos aparte, misma imagen |
| **Modificabilidad / bajo acoplamiento** | La API no conoce a quienes reaccionan; sumar un tercer suscriptor no toca el comando | El comando ya no tiene dependencias de caché ni de auditoría |
| **Disponibilidad** | Publicar y proyectar son de mejor esfuerzo; si Redis cae, la escritura se confirma igual | Verificado con Redis detenido: el ADMIN crea un activo (201) |
| **Tolerancia a fallas** | Un mensaje malo se descarta con un aviso; un fallo al procesar un evento no frena al siguiente; los pasos de la proyección son independientes (Mongo caído no impide invalidar la caché) | `crearSuscriptor.test.ts`, `crearProyecciones.test.ts`. El suscriptor se vuelve a suscribir solo si Redis se reinicia |
| **Consistencia** | **Eventual**, a propósito: una ventana de milisegundos entre el commit y la proyección; el TTL acota el desfasaje si un evento se pierde | README, "Consistencia eventual" |
| **Confiabilidad (idempotencia)** | Un evento repetido no duplica la auditoría | Índice único parcial en `idEvento`; verificado publicando el mismo evento dos veces |
| **Observabilidad** | Cada evento deja una línea en la API (con `receptores`) y otra en cada suscriptor, con el mismo `idEvento`; contador por tipo en `GET /api/estadisticas` | Logs de los tres procesos |
| **Testabilidad** | Fábricas con Redis, MongoDB y registrador por parámetro; un Redis falso en memoria | 496 tests, ninguno necesita una base |

**Verificado de punta a punta** (Docker con los siete servicios y tokens reales de Auth0): un alta, un cambio y una baja producen tres
eventos con `receptores: 2`; el historial queda con `CREAR`, `ACTUALIZAR` y `ELIMINAR` escritos por el suscriptor; el `GET` posterior a un
`PUT` es `MISS` y trae el dato nuevo; la Whale Alert aparece en el log del segundo suscriptor con el límite del usuario; el contador por tipo
sube en `/api/estadisticas`; un mensaje que no es JSON se descarta sin tumbar al suscriptor; y tras reiniciar Redis los dos suscriptores
vuelven a recibir eventos. Newman con Auth0 real: 81 requests, 162 aserciones, 0 fallas (dos corridas). Mutaciones (18): las 18 detectadas.

## 4. Reto: ¿qué pasa si el suscriptor está caído? (Pub/Sub vs Bull)

**Pub/Sub no tiene persistencia: es *fire and forget*.** `PUBLISH` entrega el mensaje a quienes están suscriptos en ese instante y
devuelve cuántos fueron; Redis no lo guarda. Quien no está conectado en ese momento no lo recibe **nunca**.

Se probó parando el suscriptor de proyecciones y creando un activo:

- el log de la API dijo `receptores: 1` (solo el de notificaciones: el parado no lo recibió);
- la lista cacheada siguió viva sin el activo nuevo (`X-Cache: HIT`) aunque MySQL ya lo tenía, porque nadie invalidó la caché;
- al volver el suscriptor, el historial **no tenía** el `CREAR`: el evento no se reenvía. El `DELETE` posterior, ya con el suscriptor sano, sí quedó auditado.

Con **BullMQ** (la cola de reportes de la Parte 5) pasó lo contrario: con el worker parado, el pedido quedó guardado en Redis en estado
`en_cola` y, al volver el worker, lo tomó y lo completó.

| | **Pub/Sub** | **Cola (Bull / BullMQ)** |
| --- | --- | --- |
| Persistencia | Ninguna: el mensaje vive solo mientras se entrega | El trabajo se guarda en Redis hasta que alguien lo procesa |
| Quién lo recibe | **Todos** los suscriptores (difusión) | **Uno** solo (el primer worker libre) |
| Si el consumidor está caído | Se pierde | Espera y se procesa al volver |
| Reintentos / confirmación | No | Sí (reintentos con espera, estados `completed` / `failed`) |
| Es adecuado para | Avisos que se corrigen solos o cuya pérdida es tolerable (invalidar una caché con TTL) | Trabajo que no se puede perder (reportes, y en rigor, la auditoría) |

**Cómo se manejaría de verdad.** Hoy la caché lo tolera (el TTL la corrige sola), pero **la auditoría no**: un hueco en el historial no se
repara. Opciones, de menor a mayor cambio: (a) **Redis Streams con grupos de consumidores**, que guardan los mensajes y dejan que el suscriptor
retome desde el último que confirmó; (b) mandar la auditoría por una **cola de BullMQ** en lugar del canal; (c) un **Transactional Outbox** en
MySQL (el evento se guarda en la misma transacción que el cambio y un proceso lo publica después), que además cubre el caso en que Redis
está caído al publicar. Se dejó Pub/Sub porque es lo que pide la letra y porque sirve para ver exactamente este límite.

> **Lo que se resignó:** la auditoría pasó de ser *de mejor esfuerzo en la API* a depender de un proceso aparte. Antes de esta parte, una
> operación quedaba auditada si MongoDB respondía en ese instante; ahora, si el suscriptor está detenido o Redis cae al publicar, no queda
> auditada. A cambio la API ya no conoce a MongoDB. Es el precio del desacople y está documentado.

## 5. ¿Qué mejoras implementarías en futuras versiones?

- **Redis Streams / Outbox** para la auditoría (ver arriba): hoy es la limitación más importante.
- **Reconstruir el modelo de lectura** (un proceso que recorre MySQL y rearma `activos:todos` y `activo:*`) para recuperarse de un
  suscriptor caído sin esperar al TTL.
- **Un canal de entrega real** para las Whale Alert (correo, webhook, push): hoy la "notificación enviada" es una línea de log.
- **Varias instancias de un mismo suscriptor**: con Pub/Sub, cada una recibiría **todos** los eventos y el trabajo se duplicaría (la
  auditoría es idempotente, las notificaciones no). Para escalar un suscriptor haría falta Streams con grupos de consumidores.
- **Cola de mensajes muertos** (*dead letter*) para los eventos que no cumplen el contrato, en vez de solo descartarlos con un aviso.
- **Un número de secuencia por activo** en el evento (por ejemplo la versión de la fila), para ordenar el historial aunque los eventos se publiquen desde
  distintas instancias en otro orden, y para que un suscriptor descarte un evento más viejo que el último que aplicó.
- **Una alarma por falta de suscriptores** (un chequeo de salud o una métrica con los receptores del último evento): hoy es un WARN en el log.
- **Evolución del contrato**: hoy un evento de otra versión se descarta; habría que aceptar la actual y la anterior durante un tiempo.

## 6. ¿Qué dificultades encontraste y cómo las resolviste?

1. **Los tests de la suite entera se quedaban sin memoria** (`Jest worker ran out of memory`) con un proceso por núcleo (16) y Docker corriendo
   en una máquina de 8 GB; pasaban de a uno. → Se limitó `maxWorkers` en `jest.config.js` (con 4 todavía falló una vez; con 2 pasó 4 corridas seguidas): la suite corre en unos 5 segundos.
2. **Una mutación sobrevivió:** quitar la comprobación de `ACTIVO_ELIMINADO` en las notificaciones no rompía nada, porque la baja ya queda
   cubierta por la ausencia de `despues`. Pero el contrato permite un `ACTIVO_ELIMINADO` con `despues`. → Se agregó ese caso al test.
3. **Con la auditoría asíncrona, tres requests de Postman dependían de que fuera inmediata** (leer justo después de escribir). Pasaron, pero
   por suerte. → La colección espera 300 ms antes de cada pedido; el README lo explica como consistencia eventual y no como un truco.
4. **La reconexión del suscriptor:** había que comprobar que, tras reiniciar Redis, el cliente se vuelva a suscribir solo (el cliente
   oficial lo hace, pero la conexión se creó con `disableOfflineQueue`). → Se reinició Redis con los suscriptores corriendo y el `PUBLISH`
   siguiente volvió a tener 2 receptores.
5. **Un guion de prueba falló una vez al crear un activo** durante el reto y no volvió a pasar al repetirlo; no dejó rastro en los logs de la API
   y no se pudo atribuir a una causa. Queda anotado como observación, no como defecto confirmado.

---

## Para discutir en clase

- Se eligió **invalidar** la caché en vez de **escribir** el dato del evento. ¿Qué se gana y qué se pierde? ¿Cambia la respuesta si el modelo de
  lectura fuera costoso de reconstruir?
- La auditoría depende ahora de que un proceso esté vivo. ¿Es aceptable que una operación quede sin registro si el suscriptor estuvo caído?
  ¿Para qué tipo de datos sí y para cuáles no?
- Con Pub/Sub dos instancias del mismo suscriptor reciben **cada una todos** los eventos. ¿Cómo escalarías el procesamiento sin duplicarlo?
- La letra pide que el modelo de lectura esté "siempre sincronizado". Con consistencia eventual, ¿qué quiere decir "siempre"?
