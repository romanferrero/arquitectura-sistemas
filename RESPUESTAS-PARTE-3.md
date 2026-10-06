# Parte 3 — Procesamiento de flujos con Pipes & Filters

Respuestas sobre cómo se resolvió la Parte 3 en **portafolio-cripto**. El detalle de uso
(endpoints, ejemplos, logs) está en el [README](README.md#pipelines-pipes--filters); acá
va el razonamiento.

> Las rutas se mantuvieron en español y bajo `/api`, como en el resto de la API:
> `POST /assets` de la letra es `POST /api/activos`, y `POST /assets/analyze` es
> `POST /api/activos/analizar`.

---

## 1. ¿Qué decisiones de arquitectura tomaste?

**Un runner genérico y dos pipelines concretos.** [`pipeline.ts`](src/pipeline/pipeline.ts)
no sabe nada de activos: define qué es un `Filtro` (un nombre y una función) y cómo un
`Pipeline` los encadena. La ingesta y el análisis son solo dos formas de armarlo.

| Decisión | Motivo |
| --- | --- |
| El pipeline es **inmutable y tipado**: `agregar()` devuelve uno nuevo y exige que la entrada del filtro coincida con la salida acumulada | Un orden incorrecto de filtros no compila, en vez de fallar en ejecución |
| **Fail fast** y se propaga el error *original*, sin envolverlo | Un `ErrorApi` conserva su código HTTP al atravesar el pipeline |
| El runner registra qué filtro terminó bien y cuál falló | Observabilidad sin que cada filtro lo repita |
| Cada filtro recibe sus **dependencias por parámetro** (logger, tasa de cambio, umbrales, reloj, generador de ids) | Se prueban sin red ni variables de entorno |
| `FiltroValidacion` **solo valida**; limpiar es trabajo del siguiente | Cada filtro hace una única operación, como pide la letra |
| La ingesta procesa **un activo**; el análisis procesa **un lote** | Es la unidad natural de cada endpoint |
| El análisis **descarta** elementos inválidos en lugar de rechazar el lote | Un elemento malo no tiene por qué invalidar a los demás; queda en el log con su índice y motivo |
| Los servicios siguen siendo los que orquestan; el controlador solo sumó `async`/`await` | Las capas de arriba casi no se enteraron del cambio |

## 2. ¿Qué arquitectura utilizaste?

Sigue siendo un **monolito modular en capas** con estilo REST. **Pipes & Filters** es un
patrón que vive *dentro* de la capa de servicios: reemplaza la lógica lineal de
`crearActivo` por una secuencia de pasos independientes.

> **Con honestidad:** la Parte 2 admitía que faltaba la inversión de dependencias. Acá se
> dio un paso: los filtros dependen de funciones recibidas por parámetro, no de módulos
> concretos. Pero sigue sin haber interfaces de puerto ni un contenedor de inyección; el
> "cableado" real (conectar el logger de Winston y la API de tasas) ocurre al tope de
> `activosServicio.ts` y `analisisServicio.ts`.

## 3. ¿Tuviste en cuenta atributos de calidad?

| Atributo | Táctica aplicada | Dónde se ve |
| --- | --- | --- |
| **Modificabilidad** | Agregar un paso es un archivo y una línea `.agregar(...)`; ningún filtro conoce a los demás | `pipelineIngesta.ts`, `pipelineAnalisis.ts` |
| **Testabilidad** | Filtros puros o con dependencias inyectadas; reloj e ids fijables | `pruebas/` (105 tests) |
| **Observabilidad** | Un log por filtro, firmado con su nombre; el análisis lleva un `idAnalisis` | `config/logger.ts`, `FiltroFormato` |
| **Fiabilidad** | Fail fast; timeout en la API de tasas; 502 si el tercero falla; un elemento malo no tumba el lote | `tasasServicio.ts`, `FiltroDepuracion` |
| **Seguridad** | La entrada de ambos endpoints entra como `unknown` y se comprueba campo por campo | `FiltroValidacion`, `FiltroDepuracion` |
| **Interoperabilidad** | Mismo formato de error de siempre; 400 si el cliente se equivoca y 502 si falla un tercero | `manejadorErrores.ts` |

> **Lo que se resignó:** rendimiento. Cada alta en otra moneda hace una llamada a la API de
> tasas, sin caché. El análisis no persiste su auditoría: el `idAnalisis` identifica la
> respuesta pero no se guarda en ningún lado.

## 4. ¿Qué mejoras implementarías en futuras versiones?

- **Caché de tasas** con TTL corto: hoy se consulta la API en cada alta en moneda extranjera.
- **Límite de tamaño del lote** en el análisis, y esquema Zod para sus elementos.
- **Volatilidad calculada** a partir de precios históricos en lugar de informada por el cliente.
- **Guardar la auditoría del análisis** y la conversión de moneda de cada alta (la Parte 4,
  con MongoDB, es el lugar natural).
- **Interfaces de puerto** para el logger y los adaptadores externos.
- **Id de correlación** por request en los logs, para seguir una petición a través de los filtros.
- **Filtros condicionales o en paralelo** si algún día hay pasos independientes entre sí.
- **Loguear los 4xx como advertencia** y no como `[ERROR]`: hoy un body inválido genera la
  misma línea que una falla real.
- Separar la configuración para poder testear `tasasServicio` y `preciosServicio` sin
  depender de `process.env`.

## 5. ¿Qué dificultades encontraste y cómo las resolviste?

1. **Jest con módulos ES y TypeScript 7.** `ts-jest` depende de la API vieja del compilador y
   Babel agregaría otra toolchain. → Un transformador de 3 líneas con
   `module.stripTypeScriptTypes`, que hace lo mismo que Node al ejecutar los `.ts`: los
   tests corren el mismo código que la aplicación.
2. **Tipar un pipeline con eslabones de tipos distintos.** Cada filtro cambia el tipo del
   dato. → `Pipeline<Entrada, Salida>` y `agregar<Siguiente>()` que verifica el encaje; el
   único `cast` queda acotado dentro de la clase.
3. **El compilador no rechazaba un orden inválido.** Lo descubrió una prueba de mutación
   (invertir dos filtros): con `ejecutar` declarado como *método*, TypeScript compara los
   parámetros de forma bivariante. → Declararlo como *propiedad* con tipo función y dejar un
   test con `@ts-expect-error` que `npm run check` verifica.
4. **"Solo validar" y "normalizar" en filtros distintos.** `" btc "` tiene que pasar la
   validación y salir intacto. → Las reglas de texto se evalúan sobre el valor recortado
   (`refine`) pero el valor que sale es el original.
5. **Mantener los mensajes de error al pasar a Zod.** → Mensajes escritos a mano en el
   esquema, para que el contrato con el cliente no cambie.
6. **La API de tipo de cambio responde 200 con el error en el cuerpo** (`result: "error"`)
   cuando la moneda no existe. → Leer el cuerpo y no confiar solo en el status.
7. **Un activo con cantidad *y* precio negativos tiene monto positivo.** → La depuración
   comprueba cada factor por separado, no el producto.
8. **Redondear antes o después de evaluar el riesgo.** Un monto de `100000.004` supera el
   umbral y redondeado ya no. → Se evalúa con el monto exacto y se redondea al final; hay un
   test para eso.
9. **Redondear la `cantidad` destruye fracciones** (`0.00345` BTC → `0`), aunque la letra dice
   "valores numéricos". → Se redondean monto, precio y volatilidad; la cantidad se conserva.
   Es una decisión explícita y está documentada.
10. **Convertir un precio diminuto puede dar 0.** → Si el resultado redondeado es cero, 400.
11. **Agregar requests a Postman sin reformatear toda la colección.** Reescribir el JSON
    tocaba 44 líneas existentes. → Inserción textual: solo líneas nuevas en el diff.
12. **Lo que encontró la revisión de código final** (`/code-review`, nivel alto), ya corregido:
    una respuesta no-JSON de la API de tasas daba 500 en vez de 502; el logger de errores
    había perdido el mensaje y el stack; `PUT` podía responder 200 sobre un activo borrado
    mientras esperaba la tasa; el análisis aceptaba símbolos que la ingesta rechaza;
    `volatilidad: null` descartaba el activo; un monto podía desbordar a `Infinity`; y los
    umbrales no admitían 0.

---

## Para discutir en clase

- Para el análisis se eligió descartar los elementos inválidos y devolver un 200 con el
  resumen. ¿Es mejor rechazar todo el lote con un 400, o eso castiga de más al cliente?
- ¿Tiene sentido que la volatilidad la informe el cliente, o debería calcularla el servidor
  con datos históricos?
- Los filtros reciben dependencias por parámetro, pero sin interfaces ni contenedor. ¿Cuándo
  se justifica dar el siguiente paso?
