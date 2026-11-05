import { createRemoteJWKSet } from "jose";
import { authConfig } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { describirError } from "../datos/describirError.ts";
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

/**
 * Baja las claves del proveedor ANTES de que la instancia diga que esta lista, y no recien con el primer pedido
 * autenticado. En el cluster de PM2 cada instancia nueva (al arrancar o al recargar) empezaba con la memoria vacia
 * y su primer pedido esperaba la descarga: con el proveedor lento o saturado ese pedido recibia un 503 (se vio en
 * el reload con trafico). Se reintenta unas veces (con la CPU saturada durante un reload el proveedor a veces tarda
 * o responde mal una vez suelta). Es de mejor esfuerzo: si no se pueden bajar, la instancia arranca igual y las baja
 * en el primer pedido, como antes.
 */
export async function precargarClaves(intentos = 3): Promise<void> {
  const registrador = registradorDe("Autenticacion");
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      await obtenerClave.reload();
      registrador.info("Claves del proveedor de identidad precargadas");
      return;
    } catch (error) {
      const resto = intento < intentos ? `reintento ${intento + 1} de ${intentos}` : "se bajan con el primer pedido";
      registrador.warn(`No se pudieron precargar las claves del proveedor (${resto}): ${describirError(error)}`);
      if (intento < intentos) await new Promise((resolver) => setTimeout(resolver, 1_000));
    }
  }
}

export const autenticar = crearMiddlewareAutenticacion(
  crearVerificadorJwt({
    issuer: configuracion.issuer,
    audience: configuracion.audience,
    claimRoles: configuracion.claimRoles,
    obtenerClave,
    registrador: registradorDe("Autenticacion"),
  }),
);
