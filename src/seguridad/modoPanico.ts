import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { describirError } from "../datos/describirError.ts";
import type { ComandosRedis } from "../datos/tiposRedis.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { usuarioDe } from "./usuarioActual.ts";

/** La clave de Redis: existe y vale "true" mientras el modo panico esta activo. */
export const CLAVE_MODO_PANICO = "modo_panico";

const esquemaCambio = z.strictObject({ activo: z.boolean("activo debe ser true o false") });

/**
 * MODO PANICO distribuido: un interruptor de emergencia que un ADMIN prende durante un incidente
 * y que bloquea TODAS las escrituras de los demas usuarios (403) hasta que lo apague.
 *
 * Vive en REDIS y no en la memoria del proceso por una razon de arquitectura: la API va a correr en
 * varias instancias (cluster, Parte 8). Una variable en memoria solo cambiaria en la instancia que
 * recibio el pedido del ADMIN, y las otras seguirian aceptando escrituras. En Redis lo ven todas
 * al instante (`SET modo_panico true`), sin reiniciar nada.
 *
 * FALLA CERRADO: si no se puede leer el interruptor (Redis caido), las escrituras de quien no es
 * ADMIN dan 503 en lugar de dejarse pasar. Ante la duda, durante un incidente, no se escribe.
 * El ADMIN no se bloquea nunca: tiene que poder operar (y apagar el modo) pase lo que pase.
 */
export function crearModoPanico(dependencias: { redis: ComandosRedis; registrador: Registrador }) {
  const { redis, registrador } = dependencias;

  async function conRedis<T>(operacion: () => Promise<T>): Promise<T> {
    try {
      return await operacion();
    } catch (error) {
      registrador.error(`No se pudo acceder al modo pánico: ${describirError(error)}`);
      throw new ErrorApi(503, "No se pudo consultar el modo pánico en este momento");
    }
  }

  async function estaActivo(): Promise<boolean> {
    return (await conRedis(() => redis.get(CLAVE_MODO_PANICO))) === "true";
  }

  return {
    estaActivo,

    /** Prende o apaga el modo panico. `cuerpo` es lo que manda el cliente: `{ "activo": true }`. */
    async establecer(cuerpo: unknown, quien: string): Promise<{ modoPanico: boolean }> {
      const resultado = esquemaCambio.safeParse(cuerpo);
      if (!resultado.success) {
        throw new ErrorApi(400, "Cuerpo inválido", resultado.error.issues.map((problema) => problema.message));
      }
      const { activo } = resultado.data;
      // SET modo_panico true  /  DEL modo_panico
      await conRedis(() => (activo ? redis.set(CLAVE_MODO_PANICO, "true") : redis.del(CLAVE_MODO_PANICO)));
      registrador.info(`${quien} ${activo ? "ACTIVÓ" : "desactivó"} el modo pánico`);
      return { modoPanico: activo };
    },

    /**
     * Middleware para las rutas de ESCRITURA (va despues de la autorizacion por rol): si el modo
     * panico esta activo, solo deja pasar a un ADMIN.
     */
    async bloquearEnModoPanico(req: Request, res: Response, next: NextFunction): Promise<void> {
      const usuario = usuarioDe(res);
      if (usuario.roles.includes("ADMIN")) {
        next(); // el ADMIN nunca se bloquea, ni siquiera se consulta Redis
        return;
      }
      if (await estaActivo()) {
        registrador.info(`Escritura bloqueada por el modo pánico: ${usuario.sub} intentó ${req.method} ${req.path}`);
        throw new ErrorApi(403, "El sistema está en modo pánico: las operaciones de escritura están bloqueadas");
      }
      next();
    },
  };
}
