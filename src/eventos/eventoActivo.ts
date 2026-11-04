import { z } from "zod";

/** El canal de Redis Pub/Sub por el que viajan los eventos de los activos. */
export const CANAL_ACTIVOS = "activos-actualizaciones";

/** Version del contrato: si cambia la forma del mensaje, sube, y los suscriptores pueden distinguirlo. */
export const VERSION_EVENTO = 1;

export const TIPOS_EVENTO_ACTIVO = ["ACTIVO_CREADO", "ACTIVO_ACTUALIZADO", "ACTIVO_ELIMINADO"] as const;
export type TipoEventoActivo = (typeof TIPOS_EVENTO_ACTIVO)[number];

const esquemaActivo = z.object({
  id: z.string().min(1),
  simbolo: z.string().min(1),
  nombre: z.string(),
  cantidad: z.number(),
  precioCompra: z.number(),
  creadoEn: z.string(),
  actualizadoEn: z.string(),
});

/**
 * EL CONTRATO del mensaje: lo que el publicador (la API) y los suscriptores acuerdan. Publicador y
 * suscriptores no se conocen, pero ESTA forma si la comparten: por eso se valida en los dos extremos
 * (al publicar, para no mandar basura; al recibir, porque el canal no garantiza nada de quien escribe).
 *
 * Que lleva cada tipo:
 *  - ACTIVO_CREADO:      `despues`
 *  - ACTIVO_ACTUALIZADO: `antes`, `despues` y `camposModificados`
 *  - ACTIVO_ELIMINADO:   `antes`
 */
export const esquemaEventoActivo = z
  .object({
    version: z.literal(VERSION_EVENTO),
    /** Identifica este evento: sirve para correlacionar logs y para que un suscriptor ignore un duplicado. */
    idEvento: z.uuid(),
    tipo: z.enum(TIPOS_EVENTO_ACTIVO),
    activoId: z.string().min(1),
    antes: esquemaActivo.optional(),
    despues: esquemaActivo.optional(),
    camposModificados: z.array(z.string()).optional(),
    metadatos: z.object({
      origen: z.string(),
      /** El `sub` de quien hizo la operacion. */
      usuario: z.string().optional(),
      conversionMoneda: z.record(z.string(), z.unknown()).optional(),
    }),
    ocurridoEn: z.iso.datetime(),
  })
  .superRefine((evento, contexto) => {
    const falta = (campo: "antes" | "despues"): void =>
      void contexto.addIssue({ code: "custom", path: [campo], message: `${evento.tipo} requiere "${campo}"` });
    if (evento.tipo === "ACTIVO_CREADO" && evento.despues === undefined) falta("despues");
    if (evento.tipo === "ACTIVO_ELIMINADO" && evento.antes === undefined) falta("antes");
    if (evento.tipo === "ACTIVO_ACTUALIZADO") {
      if (evento.antes === undefined) falta("antes");
      if (evento.despues === undefined) falta("despues");
    }
  });

export type EventoActivo = z.infer<typeof esquemaEventoActivo>;

/** Lo que pone quien publica; el resto (version, id, fecha) lo completa el publicador. */
export type DatosEventoActivo = Omit<EventoActivo, "version" | "idEvento" | "ocurridoEn">;

/** El mensaje recibido no es un JSON valido o no cumple el contrato. */
export class EventoInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "EventoInvalidoError";
  }
}

/**
 * Lee un mensaje del canal. Lanza `EventoInvalidoError` si no es JSON o no cumple el contrato: un
 * suscriptor lo deja en el log y sigue con el siguiente, sin caerse.
 */
export function parsearEventoActivo(mensaje: string): EventoActivo {
  let dato: unknown;
  try {
    dato = JSON.parse(mensaje);
  } catch {
    throw new EventoInvalidoError("El mensaje no es un JSON válido");
  }
  const resultado = esquemaEventoActivo.safeParse(dato);
  if (!resultado.success) {
    const motivos = resultado.error.issues.map((problema) => `${problema.path.join(".") || "(raíz)"}: ${problema.message}`);
    throw new EventoInvalidoError(`El mensaje no cumple el contrato: ${motivos.join("; ")}`);
  }
  return resultado.data;
}
