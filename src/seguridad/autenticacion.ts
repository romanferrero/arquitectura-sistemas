import { createRemoteJWKSet } from "jose";
import { authConfig } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { crearMiddlewareAutenticacion } from "../middlewares/autenticacion.ts";
import { crearVerificadorJwt } from "./verificadorJwt.ts";

/**
 * La autenticacion de la aplicacion: el verificador ya conectado al proveedor de identidad
 * (Auth0, Keycloak, Clerk... cualquiera que publique sus claves como JWKS) y al logger.
 *
 * `createRemoteJWKSet` baja las claves publicas del proveedor la primera vez que hacen falta y
 * las guarda en memoria: no se consulta al proveedor en cada peticion. Si llega un token con un
 * `kid` desconocido (el proveedor rotó sus claves) vuelve a bajarlas, a lo sumo una vez cada
 * `cooldownDuration`, para que un atacante no pueda forzar una descarga por cada peticion.
 */
const configuracion = authConfig();

const obtenerClave = createRemoteJWKSet(new URL(configuracion.jwksUrl), {
  timeoutDuration: 3_000, // si el proveedor no responde en 3 s, 503 en vez de colgar la peticion
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

export const autenticar = crearMiddlewareAutenticacion(
  crearVerificadorJwt({
    issuer: configuracion.issuer,
    audience: configuracion.audience,
    claimRoles: configuracion.claimRoles,
    obtenerClave,
    registrador: registradorDe("Autenticacion"),
  }),
);
