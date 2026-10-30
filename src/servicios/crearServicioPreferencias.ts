import { z } from "zod";
import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import { VALOR_MAXIMO } from "../modelos/limites.ts";
import type { Preferencias } from "../modelos/preferencias.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

/** Lo que el cliente puede enviar: cualquiera de los dos campos, pero al menos uno. */
const esquemaCambios = z
  .strictObject({
    monedaVisualizacion: z
      .string("monedaVisualizacion debe ser un texto")
      .trim()
      .regex(/^[A-Za-z]{3}$/, "monedaVisualizacion debe ser un código de 3 letras (por ejemplo USD)")
      .transform((codigo) => codigo.toUpperCase()),
    limiteAlertaUsd: z
      .number("limiteAlertaUsd debe ser un número")
      .positive("limiteAlertaUsd debe ser mayor a 0")
      .max(VALOR_MAXIMO, `limiteAlertaUsd no puede superar ${VALOR_MAXIMO}`),
  })
  .partial()
  .refine((cambios) => Object.keys(cambios).length > 0, "Se debe enviar monedaVisualizacion o limiteAlertaUsd");

/**
 * Preferencias de la billetera guardadas en un Hash de Redis: una sola clave con
 * varios campos (HSET para escribir, HGETALL para leer).
 *
 * A diferencia de la cache, ACA Redis es la fuente de verdad: no hay otra copia. Por eso,
 * si Redis falla, no se inventa una respuesta: es un 503 (servicio no disponible).
 *
 * Los campos que no se configuraron devuelven el valor por defecto.
 */
export function crearServicioPreferencias(dependencias: {
  redis: ComandosRedis;
  registrador: Registrador;
  clave: string;
  porDefecto: Preferencias;
}) {
  const { redis, registrador, clave, porDefecto } = dependencias;

  async function conRedis<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      registrador.error(`No se pudo acceder a las preferencias: ${describirError(error)}`);
      throw new ErrorApi(503, "Las preferencias no están disponibles en este momento");
    }
  }

  async function leer(): Promise<Preferencias> {
    const guardadas = await conRedis(() => redis.hGetAll(clave));
    // Redis guarda todo como texto: el limite vuelve a ser un numero.
    const texto = guardadas["limiteAlertaUsd"];
    const limite = Number(texto);
    return {
      monedaVisualizacion: guardadas["monedaVisualizacion"] ?? porDefecto.monedaVisualizacion,
      limiteAlertaUsd: texto !== undefined && Number.isFinite(limite) ? limite : porDefecto.limiteAlertaUsd,
    };
  }

  return {
    obtener: leer,

    /** Actualiza SOLO los campos enviados (HSET) y devuelve las preferencias resultantes. */
    async actualizar(cuerpo: unknown): Promise<Preferencias> {
      const resultado = esquemaCambios.safeParse(cuerpo);
      if (!resultado.success) {
        throw new ErrorApi(400, "Preferencias inválidas", resultado.error.issues.map((problema) => problema.message));
      }

      const campos: Record<string, string> = {};
      if (resultado.data.monedaVisualizacion !== undefined) campos["monedaVisualizacion"] = resultado.data.monedaVisualizacion;
      if (resultado.data.limiteAlertaUsd !== undefined) campos["limiteAlertaUsd"] = String(resultado.data.limiteAlertaUsd);

      await conRedis(() => redis.hSet(clave, campos));
      return await leer();
    },
  };
}
