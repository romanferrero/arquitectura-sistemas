import type { NextFunction, Request, Response } from "express";
import { ErrorApi } from "../errores/ErrorApi.ts";

/**
 * Se monta DESPUES de todas las rutas: si la request llego hasta aca es porque
 * ninguna ruta coincidio, entonces es un 404.
 */
export function noEncontrado(req: Request, _res: Response, next: NextFunction): void {
  next(new ErrorApi(404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

/**
 * Middleware de errores de Express: se reconoce por tener 4 parametros.
 * Es el ULTIMO middleware que se monta en app.ts.
 *
 * Express 5 deriva aca tambien las promesas rechazadas de los handlers async,
 * por eso los controladores no necesitan try/catch.
 */
export function manejadorErrores(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // 1) Errores propios de la aplicacion: ya traen su codigo HTTP.
  if (error instanceof ErrorApi) {
    res.status(error.estado).json({
      error: { mensaje: error.message, detalles: error.detalles },
    });
    return;
  }

  // 2) JSON malformado en el body: express.json() lanza un SyntaxError.
  //    Sin esto responderiamos 500 cuando en realidad la culpa es del cliente.
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      error: { mensaje: "El cuerpo de la petición no es un JSON válido" },
    });
    return;
  }

  // 3) Cualquier otra cosa: es un bug nuestro. Se loguea completo en el
  //    servidor pero al cliente solo le llega un mensaje generico.
  console.error("[error] Error no controlado:", error);
  res.status(500).json({ error: { mensaje: "Error interno del servidor" } });
}
