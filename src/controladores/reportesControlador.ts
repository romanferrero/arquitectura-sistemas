import type { Request, Response } from "express";
import { usuarioDe } from "../seguridad/usuarioActual.ts";
import { estadisticas } from "../servicios/estadisticasServicio.ts";
import { reportes } from "../servicios/reportesServicio.ts";

/**
 * Reportes asincronos y estadisticas. Como el resto de los controladores solo traduce entre
 * HTTP y el servicio.
 */

// POST /api/activos/reporte  -> 202: el pedido quedo en la cola, el reporte todavia no existe
export async function solicitar(_req: Request, res: Response): Promise<void> {
  const pedido = await reportes.solicitar(usuarioDe(res).sub);
  res
    .status(202)
    .location(`/api/reportes/${pedido.idReporte}`)
    .json({ ...pedido, consulta: `/api/reportes/${pedido.idReporte}` });
}

// GET /api/reportes/:id
export async function consultar(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await reportes.consultar(req.params.id));
}

// GET /api/estadisticas
export async function obtenerEstadisticas(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await estadisticas.obtener());
}
