import type { NextFunction, Request, Response } from "express";
import { instancia } from "../config/env.ts";

/**
 * Pone en TODAS las respuestas el header `X-Instancia` con el numero de la instancia del cluster que la atendio
 * (el `NODE_APP_INSTANCE` de PM2). Sirve para ver el reparto de la carga entre instancias, por ejemplo en la
 * prueba de carga, y para saber cual atendio un pedido que fallo.
 */
export function marcarInstancia(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Instancia", instancia());
  next();
}
