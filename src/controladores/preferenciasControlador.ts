import type { Request, Response } from "express";
import { preferencias } from "../servicios/preferenciasServicio.ts";

/** Preferencias de la billetera. Solo traduce entre HTTP y el servicio. */

// GET /api/preferencias
export async function obtener(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await preferencias.obtener());
}

// PUT /api/preferencias  (cambia solo los campos enviados)
export async function actualizar(req: Request, res: Response): Promise<void> {
  res.status(200).json(await preferencias.actualizar(req.body));
}
