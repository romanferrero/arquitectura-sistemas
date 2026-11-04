import { describe, expect, test } from "@jest/globals";
import type { Request, Response } from "express";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import { crearMiddlewareAutenticacion, extraerToken } from "../../src/middlewares/autenticacion.ts";
import type { Usuario } from "../../src/modelos/usuario.ts";
import { usuarioDe } from "../../src/seguridad/usuarioActual.ts";

const usuario: Usuario = { sub: "auth0|usuario-1", roles: ["TRADER"] };

/** Una peticion y una respuesta falsas, con solo lo que el middleware toca. */
function peticion(authorization?: string) {
  const req = { headers: authorization === undefined ? {} : { authorization } } as unknown as Request;
  const cabeceras: Record<string, string> = {};
  const res = {
    locals: {},
    setHeader: (nombre: string, valor: string) => {
      cabeceras[nombre] = valor;
    },
  } as unknown as Response;
  return { req, res, cabeceras };
}

function armar(verificar: (token: string) => Promise<Usuario> = async () => usuario) {
  const recibidos: string[] = [];
  const autenticar = crearMiddlewareAutenticacion(async (token) => {
    recibidos.push(token);
    return await verificar(token);
  });
  return { autenticar, recibidos };
}

/** Corre el middleware y devuelve el error con que fallo (o undefined) y si llamo a next(). */
async function correr(autenticar: ReturnType<typeof armar>["autenticar"], authorization?: string) {
  const { req, res, cabeceras } = peticion(authorization);
  let siguiente = false;
  let error: unknown;
  try {
    await autenticar(req, res, () => {
      siguiente = true;
    });
  } catch (e) {
    error = e;
  }
  return { error, siguiente, res, cabeceras };
}

describe("extraerToken", () => {
  test.each([
    ["Bearer abc.def.ghi", "abc.def.ghi"],
    ["bearer abc", "abc"], // el esquema no distingue mayusculas (RFC 7235)
    ["BEARER abc", "abc"],
    ["Bearer    abc", "abc"],
    ["  Bearer abc  ", "abc"],
  ])("%p → %p", (cabecera, esperado) => {
    expect(extraerToken(cabecera)).toBe(esperado);
  });

  test.each([undefined, "", "Bearer", "Bearer ", "abc.def", "Basic dXNlcjpwYXNz", "Bearer a b", "Bearertoken", "Token abc"])(
    "%p no tiene la forma Bearer <token>",
    (cabecera) => {
      expect(extraerToken(cabecera)).toBeUndefined();
    },
  );

  test("rechaza un token absurdamente largo", () => {
    expect(extraerToken(`Bearer ${"a".repeat(9_000)}`)).toBeUndefined();
    expect(extraerToken(`Bearer ${"a".repeat(8_000)}`)).toBeDefined();
  });
});

describe("crearMiddlewareAutenticacion", () => {
  test("con un token válido deja al usuario en la petición y sigue", async () => {
    const { autenticar, recibidos } = armar();

    const { error, siguiente, res } = await correr(autenticar, "Bearer token-bueno");

    expect(error).toBeUndefined();
    expect(siguiente).toBe(true);
    expect(recibidos).toEqual(["token-bueno"]);
    expect(usuarioDe(res)).toEqual(usuario);
  });

  test("sin el header Authorization da 401, con WWW-Authenticate, sin verificar nada y sin seguir", async () => {
    const { autenticar, recibidos } = armar();

    const { error, siguiente, cabeceras } = await correr(autenticar);

    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).estado).toBe(401);
    expect((error as ErrorApi).message).toContain("Falta el header Authorization");
    expect(cabeceras["WWW-Authenticate"]).toBe('Bearer realm="portafolio-cripto"');
    expect(recibidos).toEqual([]);
    expect(siguiente).toBe(false);
  });

  test.each(["Basic dXNlcjpwYXNz", "Bearer", "token-sin-esquema", "Bearer a b"])(
    "un header con otra forma (%p) da 401 y no verifica nada",
    async (cabecera) => {
      const { autenticar, recibidos } = armar();

      const { error, siguiente } = await correr(autenticar, cabecera);

      expect((error as ErrorApi).estado).toBe(401);
      expect((error as ErrorApi).message).toContain("debe tener la forma: Bearer <token>");
      expect(recibidos).toEqual([]);
      expect(siguiente).toBe(false);
    },
  );

  test("un token que el verificador rechaza (401) responde 401 con invalid_token y no sigue", async () => {
    const { autenticar } = armar(async () => {
      throw new ErrorApi(401, "El token venció");
    });

    const { error, siguiente, cabeceras } = await correr(autenticar, "Bearer vencido");

    expect((error as ErrorApi).estado).toBe(401);
    expect((error as ErrorApi).message).toBe("El token venció");
    expect(cabeceras["WWW-Authenticate"]).toBe('Bearer realm="portafolio-cripto", error="invalid_token"');
    expect(siguiente).toBe(false);
  });

  test("si el proveedor no responde (503) el error sigue de largo y SIN WWW-Authenticate", async () => {
    const { autenticar } = armar(async () => {
      throw new ErrorApi(503, "el proveedor de identidad no responde");
    });

    const { error, siguiente, cabeceras } = await correr(autenticar, "Bearer cualquiera");

    expect((error as ErrorApi).estado).toBe(503);
    expect(cabeceras["WWW-Authenticate"]).toBeUndefined();
    expect(siguiente).toBe(false);
  });

  test("un error inesperado del verificador sigue de largo (lo traduce el manejador de errores, como 500)", async () => {
    const { autenticar } = armar(async () => {
      throw new Error("bug");
    });

    const { error, siguiente } = await correr(autenticar, "Bearer x");

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ErrorApi);
    expect(siguiente).toBe(false);
  });
});

describe("usuarioDe", () => {
  test("en una ruta que no pasó por el middleware es un error de programación, no un 401", () => {
    const { res } = peticion();

    expect(() => usuarioDe(res)).toThrow("no pasó por el middleware");
  });
});
