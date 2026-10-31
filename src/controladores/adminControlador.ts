import type { Request, Response } from "express";
import { modoPanico } from "../seguridad/permisos.ts";
import { usuarioDe } from "../seguridad/usuarioActual.ts";
import { administracion } from "../servicios/administracionServicio.ts";

/** Operaciones administrativas (solo ADMIN: lo exige la ruta). Solo traduce entre HTTP y el servicio. */

// DELETE /api/admin/cache  -> vacia la cache de activos (nada mas que eso)
export async function limpiarCache(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await administracion.limpiarCache(usuarioDe(res).sub));
}

// GET /api/admin/modo-panico
export async function estadoModoPanico(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ modoPanico: await modoPanico.estaActivo() });
}

// PUT /api/admin/modo-panico  { "activo": true | false }
export async function cambiarModoPanico(req: Request, res: Response): Promise<void> {
  res.status(200).json(await modoPanico.establecer(req.body, usuarioDe(res).sub));
}
