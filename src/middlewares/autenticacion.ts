import type { NextFunction, Request, Response } from "express";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Usuario } from "../modelos/usuario.ts";
import { guardarUsuario } from "../seguridad/usuarioActual.ts";

const REINO = 'Bearer realm="portafolio-cripto"';
/** Un JWT real mide unos cientos de bytes; esto corta de entrada lo absurdo. */
const LARGO_MAXIMO_TOKEN = 8_192;

/** Saca el token de `Authorization: Bearer <token>`; undefined si el header no tiene esa forma. */
export function extraerToken(cabecera: string | undefined): string | undefined {
  if (cabecera === undefined) return undefined;
  const coincidencia = /^Bearer +(\S+)$/i.exec(cabecera.trim());
  const token = coincidencia?.[1];
  return token !== undefined && token.length <= LARGO_MAXIMO_TOKEN ? token : undefined;
}

/**
 * Middleware de autenticacion: exige `Authorization: Bearer <token>`, verifica el token y deja
 * al usuario en `res.locals` (se lee con `usuarioDe(res)`). Sin token, o con uno invalido o
 * vencido, responde 401; no llega al controlador.
 *
 * Es una FABRICA: la verificacion entra por parametro (ver verificadorJwt.ts).
 *
 * El 401 lleva `WWW-Authenticate`, como pide HTTP, para que el cliente sepa que esquema usar.
 * Los 503 (el proveedor de identidad no responde) NO la llevan: reenviar el token no ayudaria.
 */
export function crearMiddlewareAutenticacion(verificar: (token: string) => Promise<Usuario>) {
  return async function autenticar(req: Request, res: Response, next: NextFunction): Promise<void> {
    const cabecera = req.headers.authorization;
    const token = extraerToken(cabecera);
    if (token === undefined) {
      res.setHeader("WWW-Authenticate", REINO);
      throw new ErrorApi(
        401,
        cabecera === undefined
          ? "Falta el header Authorization: Bearer <token>"
          : "El header Authorization debe tener la forma: Bearer <token>",
      );
    }

    let usuario: Usuario;
    try {
      usuario = await verificar(token);
    } catch (error) {
      if (error instanceof ErrorApi && error.estado === 401) {
        res.setHeader("WWW-Authenticate", `${REINO}, error="invalid_token"`);
      }
      throw error;
    }

    guardarUsuario(res, usuario);
    next();
  };
}
