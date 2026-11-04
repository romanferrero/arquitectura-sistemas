import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * PROVEEDOR DE IDENTIDAD FALSO, solo para desarrollo y pruebas. NUNCA en produccion.
 *
 * Hace lo mismo que Auth0 de cara a la API, pero en local y sin cuenta:
 *   GET  /.well-known/jwks.json   las claves publicas con las que se verifican los tokens
 *   POST /oauth/token             emite un token (grant_type=password, como el de Auth0)
 *
 * Sirve para correr Newman y las pruebas de carga sin depender de un servicio externo, y para
 * probar los casos que Auth0 no deja forzar (un token vencido, un rol inexistente).
 *
 *   npm run idp:falso
 *   # y la API, apuntando a el:
 *   AUTH_ISSUER=http://localhost:4000/ AUTH_JWKS_URL=http://localhost:4000/.well-known/jwks.json npm run dev
 *
 * Usuarios (todos con la contrasena `prueba123`): auditor@prueba.com, trader@prueba.com,
 * admin@prueba.com y sinrol@prueba.com (un usuario valido sin ningun rol).
 *
 * Las claves se generan al arrancar: cada vez que se reinicia, los tokens anteriores dejan de valer.
 *
 * Esta herramienta vive FUERA de `src/` y no entra en la imagen de Docker. Por eso lee su
 * configuracion directo de `process.env` (la regla de usar solo `config/env.ts` es de la aplicacion).
 */
const PUERTO = Number(process.env["IDP_PUERTO"] ?? 4000);
const ISSUER = process.env["IDP_ISSUER"] ?? `http://localhost:${PUERTO}/`;
const AUDIENCE = process.env["AUTH_AUDIENCE"] ?? "https://portafolio-cripto/api";
const CLAIM_ROLES = process.env["AUTH_CLAIM_ROLES"] ?? "https://portafolio-cripto/roles";
const PASSWORD = "prueba123";

const USUARIOS: Record<string, { sub: string; roles: string[] }> = {
  "auditor@prueba.com": { sub: "idp-falso|auditor", roles: ["AUDITOR"] },
  "trader@prueba.com": { sub: "idp-falso|trader", roles: ["TRADER"] },
  "admin@prueba.com": { sub: "idp-falso|admin", roles: ["ADMIN"] },
  "sinrol@prueba.com": { sub: "idp-falso|sinrol", roles: [] },
};

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "idp-falso-1", alg: "RS256", use: "sig" }] };

async function leerCuerpo(req: IncomingMessage): Promise<Record<string, string>> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  const texto = Buffer.concat(partes).toString("utf8");
  if (texto === "") return {};
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    return JSON.parse(texto) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(texto));
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  const responder = (estado: number, cuerpo: unknown): void => {
    res.writeHead(estado, { "content-type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };

  try {
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") return responder(200, jwks);

    if (req.method === "POST" && url.pathname === "/oauth/token") {
      const datos = await leerCuerpo(req);
      // `Object.hasOwn`: un `username=__proto__` o `constructor` no tiene que "existir" por herencia.
      const nombre = datos["username"] ?? "";
      const usuario = Object.hasOwn(USUARIOS, nombre) ? USUARIOS[nombre] : undefined;
      if (datos["grant_type"] !== "password" || usuario === undefined || datos["password"] !== PASSWORD) {
        return responder(403, { error: "invalid_grant", error_description: "Wrong email or password." });
      }
      // `?vence_en=-60` emite un token que ya vencio hace un minuto: para probar el 401 de un token vencido.
      const venceEn = Number(url.searchParams.get("vence_en") ?? 3600);
      if (!Number.isFinite(venceEn)) return responder(400, { error: "invalid_request", error_description: "vence_en debe ser un numero" });
      const ahora = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ [CLAIM_ROLES]: usuario.roles })
        .setProtectedHeader({ alg: "RS256", kid: "idp-falso-1" })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(usuario.sub)
        .setIssuedAt(ahora)
        .setExpirationTime(ahora + venceEn)
        .sign(privateKey);
      return responder(200, { access_token: token, token_type: "Bearer", expires_in: venceEn });
    }

    responder(404, { error: "not_found" });
  } catch (error) {
    responder(500, { error: String(error) });
  }
});

// Solo en la maquina local: nunca se expone al resto de la red.
servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`[idp-falso] Escuchando en ${ISSUER} (solo desarrollo)`);
  console.log(`[idp-falso] issuer=${ISSUER} audience=${AUDIENCE} claim de roles=${CLAIM_ROLES}`);
  console.log("[idp-falso] Usuarios: auditor@, trader@, admin@, sinrol@ prueba.com (contraseña prueba123)");
});
