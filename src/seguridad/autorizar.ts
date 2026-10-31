import type { NextFunction, Request, Response } from "express";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Rol } from "../modelos/usuario.ts";
import type { Registrador } from "../pipeline/pipeline.ts";
import { usuarioDe } from "./usuarioActual.ts";

/**
 * AUTORIZACION por roles (RBAC): decide si el usuario YA autenticado puede hacer esta operacion.
 *
 * Es la segunda mitad de la seguridad. La autenticacion (middlewares/autenticacion.ts) responde
 * "quien sos" y da 401 si no se sabe; esta responde "que podes hacer" y da **403**: se sabe
 * perfectamente quien es, pero no tiene permiso. Un usuario valido SIN roles (por ejemplo, uno al
 * que todavia no se le asigno ninguno en el proveedor) no pasa por ninguna ruta protegida.
 *
 * Es una FABRICA para poder probarla con un registrador falso. Se usa asi, ruta por ruta:
 *
 *   rutas.delete("/activos/:id", autorizar("TRADER", "ADMIN"), controlador.eliminar);
 *
 * Cada acceso denegado queda en el log (quien, con que roles, que intento): es justo lo que se
 * busca despues de un incidente.
 */
export function crearAutorizacion(registrador: Registrador) {
  return function autorizar(...rolesPermitidos: Rol[]) {
    return function verificarRol(req: Request, res: Response, next: NextFunction): void {
      const usuario = usuarioDe(res);
      if (usuario.roles.some((rol) => rolesPermitidos.includes(rol))) {
        next();
        return;
      }
      registrador.info(
        `Acceso denegado: ${usuario.sub} (roles: ${usuario.roles.join(", ") || "ninguno"}) intentó ${req.method} ${req.path}`,
      );
      throw new ErrorApi(403, `No tiene permiso para esta operación. Roles necesarios: ${rolesPermitidos.join(", ")}`);
    };
  };
}
