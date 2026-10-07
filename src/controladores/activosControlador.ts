import type { Request, Response } from "express";
import * as servicio from "../servicios/activosServicio.ts";
import { analizarActivos } from "../servicios/analisisServicio.ts";
import { obtenerPrecio } from "../servicios/preciosServicio.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import { validarSimbolo } from "../validaciones/activoValidacion.ts";
import { env } from "../config/env.ts";

/**
 * Los controladores solo traducen entre HTTP y el servicio: leen params/body,
 * llaman al servicio y eligen el codigo de estado. Cero logica de negocio.
 *
 * No hay try/catch: Express 5 deriva automaticamente al manejador de errores
 * tanto las excepciones sincronicas como las promesas rechazadas.
 *
 * `Request<{ id: string }>` le indica a TypeScript la forma de req.params, asi
 * se accede a req.params.id sin conversiones ni comprobaciones extra.
 */

// GET /api/activos  (opcional: ?simbolo=BTC)
export async function listar(req: Request, res: Response): Promise<void> {
  const simbolo = typeof req.query["simbolo"] === "string" ? req.query["simbolo"] : undefined;
  res.status(200).json(await servicio.listarActivos(simbolo));
}

// GET /api/activos/:id
export async function obtener(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await servicio.obtenerActivo(req.params.id));
}

// POST /api/activos
export async function crear(req: Request, res: Response): Promise<void> {
  const activo = await servicio.crearActivo(req.body);
  res.status(201).location(`/api/activos/${activo.id}`).json(activo);
}

// PUT /api/activos/:id
export async function actualizar(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await servicio.actualizarActivo(req.params.id, req.body));
}

// DELETE /api/activos/:id
export async function eliminar(req: Request<{ id: string }>, res: Response): Promise<void> {
  await servicio.eliminarActivo(req.params.id);
  res.status(204).send(); // 204 no lleva cuerpo
}

// POST /api/activos/analizar  (recibe un array; no guarda nada)
export async function analizar(req: Request, res: Response): Promise<void> {
  res.status(200).json(await analizarActivos(req.body));
}

// GET /api/activos/:id/precio
export async function obtenerConPrecio(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  res.status(200).json(await servicio.obtenerActivoConPrecio(req.params.id));
}

// GET /api/precios/:simbolo
export async function precioPorSimbolo(
  req: Request<{ simbolo: string }>,
  res: Response,
): Promise<void> {
  const simbolo = validarSimbolo(req.params.simbolo);
  if (simbolo === undefined) {
    throw new ErrorApi(400, "El símbolo debe tener entre 1 y 10 caracteres alfanuméricos");
  }

  const precio = await obtenerPrecio(simbolo);
  res.status(200).json({
    simbolo,
    precio,
    moneda: env.MONEDA,
    consultadoEn: new Date().toISOString(),
  });
}
