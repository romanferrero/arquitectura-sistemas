import type { Response } from "express";
import type { Usuario } from "../modelos/usuario.ts";

/** Donde el middleware de autenticacion deja al usuario verificado, dentro de `res.locals`. */
const CLAVE = "usuario";

export function guardarUsuario(res: Response, usuario: Usuario): void {
  res.locals[CLAVE] = usuario;
}

/**
 * El usuario autenticado de esta peticion. Solo se puede llamar en rutas que pasaron por el
 * middleware de autenticacion; si no, es un error de programacion (no del cliente).
 */
export function usuarioDe(res: Response): Usuario {
  const usuario: unknown = res.locals[CLAVE];
  if (usuario === undefined) {
    throw new Error("No hay usuario en la peticion: la ruta no pasó por el middleware de autenticación");
  }
  return usuario as Usuario;
}
