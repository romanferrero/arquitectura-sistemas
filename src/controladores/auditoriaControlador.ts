import type { Request, Response } from "express";
import { historialDeActivo } from "../servicios/activosServicio.ts";
import { auditoria } from "../servicios/auditoriaServicio.ts";

/**
 * Consulta del historial de auditoria. Como el resto de los controladores solo
 * traduce entre HTTP y el servicio: lee params y query, y elige el codigo.
 */

// GET /api/activos/:id/historial
export async function historial(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await historialDeActivo(req.params.id));
}

// GET /api/auditoria  (opcional: ?operacion=ELIMINAR&limite=20)
export async function listarAuditoria(req: Request, res: Response): Promise<void> {
  const texto = (valor: unknown): string | undefined => (typeof valor === "string" ? valor : undefined);
  res.status(200).json(
    await auditoria.listar({ operacion: texto(req.query["operacion"]), limite: texto(req.query["limite"]) }),
  );
}
