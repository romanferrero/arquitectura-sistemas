import type { Request, Response } from "express";
import { salud } from "../servicios/saludServicio.ts";

/**
 * GET /salud: 200 si esta instancia llega a MySQL, MongoDB y Redis; 503 si alguna no responde o si la
 * instancia se esta apagando. Es publico (lo usan Docker y los monitores, que no tienen token).
 */
export async function obtenerSalud(_req: Request, res: Response): Promise<void> {
  const resultado = await salud.comprobar();
  res.status(resultado.estado === "ok" ? 200 : 503).json(resultado);
}
