import { describe, expect, test } from "@jest/globals";
import { SignJWT, UnsecuredJWT, createLocalJWKSet, errors, exportJWK, generateKeyPair } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import { crearVerificadorJwt } from "../../src/seguridad/verificadorJwt.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

const ISSUER = "https://idp.prueba/";
const AUDIENCE = "https://portafolio-cripto/api";
const CLAIM = "https://portafolio-cripto/roles";

// Las claves se generan una sola vez: crear un par RSA es lo mas lento de todo el archivo.
const buena = await generarClave("clave-buena");
const ajena = await generarClave("clave-ajena"); // otra clave que el verificador NO conoce

async function generarClave(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwk, kid };
}

/** Las claves publicas que "publica el proveedor": solo la buena. */
const claves: JWTVerifyGetKey = createLocalJWKSet({ keys: [buena.jwk] });

function armar(obtenerClave: JWTVerifyGetKey = claves) {
  const registro = crearRegistroEnMemoria();
  const verificar = crearVerificadorJwt({
    issuer: ISSUER,
    audience: AUDIENCE,
    claimRoles: CLAIM,
    obtenerClave,
    registrador: registro.registradorDe("Autenticacion"),
  });
  return { verificar, lineas: registro.lineas };
}

/** Un token valido, con ajustes. `quitar` borra claims para probar que faltan. */
async function firmar(
  ajustes: { claims?: Record<string, unknown>; clave?: typeof buena; issuer?: string; audience?: string; exp?: string | number; nbf?: number; sub?: string | null } = {},
): Promise<string> {
  const clave = ajustes.clave ?? buena;
  let jwt = new SignJWT({ [CLAIM]: ["TRADER"], ...ajustes.claims })
    .setProtectedHeader({ alg: "RS256", kid: clave.kid })
    .setIssuer(ajustes.issuer ?? ISSUER)
    .setAudience(ajustes.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ajustes.exp ?? "1h");
  if (ajustes.sub !== null) jwt = jwt.setSubject(ajustes.sub ?? "auth0|usuario-1");
  if (ajustes.nbf !== undefined) jwt = jwt.setNotBefore(ajustes.nbf);
  return await jwt.sign(clave.privateKey);
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error("Se esperaba un ErrorApi y no hubo error");
}

describe("crearVerificadorJwt · token válido", () => {
  test("devuelve el usuario y sus roles", async () => {
    const { verificar } = armar();

    expect(await verificar(await firmar({ claims: { [CLAIM]: ["TRADER", "AUDITOR"] } }))).toEqual({
      sub: "auth0|usuario-1",
      roles: ["AUDITOR", "TRADER"],
    });
  });

  test("los roles vienen en un orden fijo, sin repetidos", async () => {
    const { verificar } = armar();

    const usuario = await verificar(await firmar({ claims: { [CLAIM]: ["ADMIN", "ADMIN", "AUDITOR"] } }));

    expect(usuario.roles).toEqual(["AUDITOR", "ADMIN"]);
  });

  test("los roles que no se conocen se descartan", async () => {
    const { verificar } = armar();

    const usuario = await verificar(await firmar({ claims: { [CLAIM]: ["TRADER", "SUPERADMIN", "admin", 7] } }));

    expect(usuario.roles).toEqual(["TRADER"]);
  });

  test.each([
    ["no trae el claim de roles", {}],
    ["trae los roles como un texto y no como una lista", { [CLAIM]: "ADMIN" }],
    ["trae los roles como un objeto", { [CLAIM]: { ADMIN: true } }],
    ["trae una lista vacía", { [CLAIM]: [] }],
  ])("un token que %s es válido pero sin roles", async (_descripcion, claims) => {
    const { verificar } = armar();
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: buena.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|usuario-1")
      .setExpirationTime("1h")
      .sign(buena.privateKey);

    expect((await verificar(token)).roles).toEqual([]);
  });

  test("un claim de roles con otro nombre no se toma en cuenta", async () => {
    const { verificar } = armar();

    const usuario = await verificar(await firmar({ claims: { [CLAIM]: [], roles: ["ADMIN"], "https://otro/roles": ["ADMIN"] } }));

    expect(usuario.roles).toEqual([]);
  });

  test("acepta una audiencia en lista si incluye la de esta API", async () => {
    const { verificar } = armar();
    const token = await new SignJWT({ [CLAIM]: ["TRADER"] })
      .setProtectedHeader({ alg: "RS256", kid: buena.kid })
      .setIssuer(ISSUER)
      .setAudience([AUDIENCE, "https://userinfo"])
      .setSubject("auth0|usuario-1")
      .setExpirationTime("1h")
      .sign(buena.privateKey);

    expect((await verificar(token)).sub).toBe("auth0|usuario-1");
  });
});

describe("crearVerificadorJwt · token inválido (401)", () => {
  test("un token vencido da 401 y lo dice", async () => {
    const { verificar } = armar();
    const vencido = await firmar({ exp: Math.floor(Date.now() / 1000) - 3_600 });

    const error = await errorDe(verificar(vencido));

    expect(error.estado).toBe(401);
    expect(error.message).toBe("El token venció");
  });

  test("tolera unos segundos de desfasaje de reloj, no más", async () => {
    const { verificar } = armar();
    const ahora = Math.floor(Date.now() / 1000);

    await expect(verificar(await firmar({ exp: ahora - 2 }))).resolves.toBeDefined(); // venció hace 2 s: dentro del margen
    expect((await errorDe(verificar(await firmar({ exp: ahora - 60 })))).estado).toBe(401);
  });

  test("un token que todavía no es válido (nbf en el futuro) da 401", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ nbf: Math.floor(Date.now() / 1000) + 3_600 })))).estado).toBe(401);
  });

  test("un token firmado con una clave que el proveedor no publica da 401", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ clave: ajena })))).estado).toBe(401);
  });

  test("un token con el kid correcto pero firmado con otra clave da 401 (firma falsa)", async () => {
    const { verificar } = armar();
    const falso = await firmar({ clave: { ...ajena, kid: buena.kid } });

    expect((await errorDe(verificar(falso))).estado).toBe(401);
  });

  test("un token con el cuerpo alterado después de firmar da 401", async () => {
    const { verificar } = armar();
    const [cabecera, , firma] = (await firmar()).split(".");
    const cuerpoFalso = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: "auth0|usuario-1", exp: 9_999_999_999, [CLAIM]: ["ADMIN"] }),
    ).toString("base64url");

    expect((await errorDe(verificar(`${cabecera}.${cuerpoFalso}.${firma}`))).estado).toBe(401);
  });

  test("un token con alg: none (sin firma) da 401", async () => {
    const { verificar } = armar();
    const sinFirma = new UnsecuredJWT({ [CLAIM]: ["ADMIN"] })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|usuario-1")
      .setExpirationTime("1h")
      .encode();

    expect((await errorDe(verificar(sinFirma))).estado).toBe(401);
  });

  test("un token HS256 firmado con la clave pública como secreto da 401 (confusión de algoritmo)", async () => {
    const { verificar } = armar();
    const secreto = new TextEncoder().encode(JSON.stringify(buena.jwk));
    const confuso = await new SignJWT({ [CLAIM]: ["ADMIN"] })
      .setProtectedHeader({ alg: "HS256", kid: buena.kid })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("auth0|usuario-1")
      .setExpirationTime("1h")
      .sign(secreto);

    expect((await errorDe(verificar(confuso))).estado).toBe(401);
  });

  test("un token para otra audiencia da 401", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ audience: "https://otra-api" })))).estado).toBe(401);
  });

  test("un token de otro emisor da 401", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ issuer: "https://impostor.auth0.com/" })))).estado).toBe(401);
  });

  test("el emisor tiene que coincidir exacto (sin la barra final no vale)", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ issuer: "https://idp.prueba" })))).estado).toBe(401);
  });

  test("un token sin sub da 401: sin saber quién es no hay usuario", async () => {
    const { verificar } = armar();

    expect((await errorDe(verificar(await firmar({ sub: null })))).estado).toBe(401);
  });

  test.each(["", "basura", "a.b.c", "eyJhbGciOiJSUzI1NiJ9.e30.", "no.es.un.jwt.valido"])("el texto %p no es un token: 401", async (texto) => {
    const { verificar } = armar();

    expect((await errorDe(verificar(texto))).estado).toBe(401);
  });

  test("un token firmado con un kid que no está en las claves da 401", async () => {
    const { verificar } = armar();
    const desconocido = await firmar({ clave: { ...buena, kid: "otro-kid" } });

    expect((await errorDe(verificar(desconocido))).estado).toBe(401);
  });

  test("el mensaje de un token inválido no dice qué falló (no ayuda a un atacante)", async () => {
    const { verificar } = armar();

    const error = await errorDe(verificar(await firmar({ clave: ajena })));

    expect(error.message).toBe("Token inválido");
  });
});

describe("crearVerificadorJwt · el proveedor de identidad no responde (503)", () => {
  test("si no se pueden bajar las claves por tiempo agotado da 503 y se loguea", async () => {
    const { verificar, lineas } = armar(async () => {
      throw new errors.JWKSTimeout();
    });

    const error = await errorDe(verificar(await firmar()));

    expect(error.estado).toBe(503);
    expect(lineas[0]).toContain("[ERROR] Autenticacion: No se pudieron obtener las claves");
  });

  test("si las claves del proveedor llegan mal formadas da 503", async () => {
    const { verificar } = armar(async () => {
      throw new errors.JWKSInvalid("JSON Web Key Set malformed");
    });

    expect((await errorDe(verificar(await firmar()))).estado).toBe(503);
  });

  test("si el proveedor responde con un error HTTP da 503", async () => {
    const { verificar } = armar(async () => {
      throw new errors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
    });

    expect((await errorDe(verificar(await firmar()))).estado).toBe(503);
  });

  test("un error de red (que no es de jose) da 503 y no 401: no es culpa del cliente", async () => {
    const { verificar, lineas } = armar(async () => {
      throw new TypeError("fetch failed");
    });

    expect((await errorDe(verificar(await firmar()))).estado).toBe(503);
    expect(lineas[0]).toContain("fetch failed");
  });

  test("con las claves caídas, un token roto igual da 401 si se puede saber antes de pedirlas", async () => {
    // "basura" ni siquiera es un JWT: se rechaza al leerlo, sin llegar a buscar la clave.
    const { verificar } = armar(async () => {
      throw new errors.JWKSTimeout();
    });

    expect((await errorDe(verificar("basura"))).estado).toBe(401);
  });
});
