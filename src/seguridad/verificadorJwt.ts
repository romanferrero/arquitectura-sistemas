import { errors, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { ErrorApi } from "../errores/ErrorApi.ts";
import { ROLES } from "../modelos/usuario.ts";
import type { Rol, Usuario } from "../modelos/usuario.ts";
import type { Registrador } from "../pipeline/pipeline.ts";

export type ConfigVerificador = {
  /** Quien emite los tokens (claim `iss`). Tiene que coincidir EXACTO: en Auth0 termina en "/". */
  issuer: string;
  /** Para quien son los tokens (claim `aud`): el identificador de esta API en el proveedor. */
  audience: string;
  /** Nombre del claim que trae los roles (con Auth0, uno propio con espacio de nombres). */
  claimRoles: string;
  /** Como se consigue la clave publica que firmo el token: en la app las JWKS del proveedor. */
  obtenerClave: JWTVerifyGetKey;
  registrador: Registrador;
  /** Margen (en segundos) para relojes desfasados al mirar `exp` y `nbf`. */
  toleranciaSegundos?: number;
};

/**
 * Verifica un JWT y devuelve quien es el usuario y que roles tiene.
 *
 * Es una FABRICA: la clave entra por parametro. En la aplicacion es el conjunto de claves
 * publicas (JWKS) del proveedor de identidad, que `jose` baja y guarda en memoria; en los tests
 * son claves generadas al momento, asi se prueba sin red.
 *
 * Que se comprueba (todo debe cumplirse):
 *  - la FIRMA, con la clave publica que corresponde al `kid` del token;
 *  - el algoritmo: SOLO RS256. Sin esta lista cerrada, un token con `alg: none` o firmado con
 *    HS256 usando la clave publica como secreto (ataque de confusion de algoritmo) podria pasar;
 *  - `iss` (emisor), `aud` (destinatario), `exp` (vencimiento) y `nbf` (no antes de);
 *  - que tenga `sub`: sin saber quien es, no hay usuario.
 *
 * Dos clases de falla, con distinto codigo HTTP:
 *  - 401: el token es invalido, esta vencido o no es para esta API. Culpa del cliente.
 *  - 503: no se pudieron bajar las claves del proveedor. No es culpa del cliente ni del token.
 */
export function crearVerificadorJwt(config: ConfigVerificador) {
  const { issuer, audience, claimRoles, obtenerClave, registrador, toleranciaSegundos = 5 } = config;

  return async function verificar(token: string): Promise<Usuario> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, obtenerClave, {
        issuer,
        audience,
        algorithms: ["RS256"],
        clockTolerance: toleranciaSegundos,
      }));
    } catch (error) {
      throw traducir(error, registrador);
    }

    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new ErrorApi(401, "El token no identifica a ningún usuario");
    }
    return { sub: payload.sub, roles: rolesDe(payload[claimRoles]) };
  };
}

/** Los roles que trae el claim. Lo que no sea una lista de textos, o no sea un rol conocido, se descarta. */
function rolesDe(claim: unknown): Rol[] {
  if (!Array.isArray(claim)) return [];
  return ROLES.filter((rol) => claim.includes(rol));
}

/** De un error de `jose` al ErrorApi que corresponde. */
function traducir(error: unknown, registrador: Registrador): ErrorApi {
  if (error instanceof errors.JWTExpired) {
    return new ErrorApi(401, "El token venció");
  }
  // Fallo de INFRAESTRUCTURA al conseguir las claves: sin ellas no se puede decidir nada.
  if (esFalloDelProveedor(error)) {
    registrador.error(`No se pudieron obtener las claves del proveedor de identidad: ${describir(error)}`);
    return new ErrorApi(503, "No se pudo verificar el token: el proveedor de identidad no responde");
  }
  // Todo lo demas que lance `jose` es un problema del token. No se detalla cual: no ayuda a un atacante.
  if (error instanceof errors.JOSEError) {
    return new ErrorApi(401, "Token inválido");
  }
  // Un error que no es de `jose` no es culpa del cliente. Lo unico que sale a la red al verificar
  // es la descarga de las claves, asi que casi siempre es eso (por ejemplo `fetch failed`).
  registrador.error(`Error inesperado al verificar el token (probablemente la red): ${describir(error)}`);
  return new ErrorApi(503, "No se pudo verificar el token: el proveedor de identidad no responde");
}

function esFalloDelProveedor(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
  // La descarga de las JWKS que no devuelve 200 se informa como un error generico de jose.
  return error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/i.test(error.message);
}

function describir(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
