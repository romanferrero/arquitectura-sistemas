import type { DatosActivo } from "../../modelos/activo.ts";

/**
 * Formas que va tomando el activo mientras recorre el pipeline de ingesta.
 * Cada filtro recibe una y devuelve la siguiente; el compilador verifica que
 * los eslabones encajen.
 *
 *   unknown --Validacion--> ActivoEntrada --Normalizacion--> ActivoNormalizado
 *           --ConversionMoneda--> ActivoIngestado
 */

/** El body ya validado, pero todavia tal cual lo escribio el cliente. */
export type ActivoEntrada = {
  simbolo: string;
  nombre: string;
  cantidad: number;
  precioCompra: number;
  /** Codigo ISO de la moneda del precio. Si no viene se asume USD. */
  moneda?: string | undefined;
};

/** Texto limpio y moneda definida (siempre presente, en mayusculas). */
export type ActivoNormalizado = DatosActivo & { moneda: string };

/** Lo que se hizo para llevar el precio a USD, por si hace falta auditarlo. */
export type ConversionMoneda = {
  monedaOriginal: string;
  precioOriginal: number;
  tasa: number;
};

/** Resultado final: los datos listos para guardar y, si hubo, la conversion. */
export type ActivoIngestado = {
  datos: DatosActivo;
  conversion: ConversionMoneda | undefined;
};
