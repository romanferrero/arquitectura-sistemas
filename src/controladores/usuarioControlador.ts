import type { Request, Response } from "express";
import { usuarioDe } from "../seguridad/usuarioActual.ts";

// GET /api/yo  -> quien es el usuario del token y que roles tiene
export function perfil(_req: Request, res: Response): void {
  res.status(200).json(usuarioDe(res));
}
