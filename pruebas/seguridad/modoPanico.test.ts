import { describe, expect, test } from "@jest/globals";
import type { Request, Response } from "express";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { Rol, Usuario } from "../../src/modelos/usuario.ts";
import { CLAVE_MODO_PANICO, crearModoPanico } from "../../src/seguridad/modoPanico.ts";
import { guardarUsuario } from "../../src/seguridad/usuarioActual.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { crearRedisFalso } from "../ayudas/redisFalso.ts";

function armar() {
  const falso = crearRedisFalso();
  const registro = crearRegistroEnMemoria();
  const modo = crearModoPanico({ redis: falso.redis, registrador: registro.registradorDe("ModoPanico") });
  return { ...falso, modo, lineas: registro.lineas };
}

/** Corre el middleware de bloqueo para un usuario; devuelve el error (o undefined) y si siguio. */
async function escribir(modo: ReturnType<typeof armar>["modo"], roles: Rol[], sub = "auth0|ana") {
  const res = { locals: {} } as unknown as Response;
  const usuario: Usuario = { sub, roles };
  guardarUsuario(res, usuario);
  let siguio = false;
  let error: unknown;
  try {
    await modo.bloquearEnModoPanico({ method: "POST", path: "/activos" } as unknown as Request, res, () => {
      siguio = true;
    });
  } catch (e) {
    error = e;
  }
  return { error, siguio };
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

describe("crearModoPanico · prender y apagar", () => {
  test("arranca apagado", async () => {
    const { modo } = armar();

    expect(await modo.estaActivo()).toBe(false);
  });

  test("activarlo hace SET modo_panico true en Redis", async () => {
    const { modo, textos } = armar();

    expect(await modo.establecer({ activo: true }, "auth0|admin")).toEqual({ modoPanico: true });

    expect(textos.get(CLAVE_MODO_PANICO)).toBe("true");
    expect(await modo.estaActivo()).toBe(true);
  });

  test("desactivarlo borra la clave", async () => {
    const { modo, textos } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    expect(await modo.establecer({ activo: false }, "auth0|admin")).toEqual({ modoPanico: false });

    expect(textos.has(CLAVE_MODO_PANICO)).toBe(false);
    expect(await modo.estaActivo()).toBe(false);
  });

  test("activarlo dos veces no cambia nada (es idempotente)", async () => {
    const { modo } = armar();

    await modo.establecer({ activo: true }, "auth0|admin");
    await modo.establecer({ activo: true }, "auth0|admin");

    expect(await modo.estaActivo()).toBe(true);
  });

  test("solo vale la clave con el valor exacto 'true': cualquier otra cosa es apagado", async () => {
    const { modo, textos } = armar();
    textos.set(CLAVE_MODO_PANICO, "TRUE");
    expect(await modo.estaActivo()).toBe(false);
    textos.set(CLAVE_MODO_PANICO, "1");
    expect(await modo.estaActivo()).toBe(false);
  });

  test("quién lo prendió o apagó queda en el log", async () => {
    const { modo, lineas } = armar();

    await modo.establecer({ activo: true }, "auth0|admin");
    await modo.establecer({ activo: false }, "auth0|admin");

    expect(lineas).toEqual([
      "[INFO] ModoPanico: auth0|admin ACTIVÓ el modo pánico",
      "[INFO] ModoPanico: auth0|admin desactivó el modo pánico",
    ]);
  });

  test.each([
    ["un cuerpo vacío", {}],
    ["activo como texto", { activo: "true" }],
    ["activo como número", { activo: 1 }],
    ["un campo de más", { activo: true, motivo: "incidente" }],
    ["algo que no es un objeto", "true"],
    ["nada", undefined],
  ])("rechaza con 400 %s y no toca Redis", async (_descripcion, cuerpo) => {
    const { modo, comandos } = armar();

    expect((await errorDe(modo.establecer(cuerpo, "auth0|admin"))).estado).toBe(400);
    expect(comandos).toEqual([]);
  });

  test("con Redis caído, prenderlo o consultarlo da 503", async () => {
    const { modo, estado } = armar();
    estado.caido = true;

    expect((await errorDe(modo.establecer({ activo: true }, "auth0|admin"))).estado).toBe(503);
    expect((await errorDe(modo.estaActivo())).estado).toBe(503);
  });
});

describe("crearModoPanico · bloquear las escrituras", () => {
  test("con el modo apagado deja pasar a un TRADER", async () => {
    const { modo } = armar();

    const { error, siguio } = await escribir(modo, ["TRADER"]);

    expect(error).toBeUndefined();
    expect(siguio).toBe(true);
  });

  test("con el modo ACTIVO un TRADER recibe 403 y no pasa", async () => {
    const { modo } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    const { error, siguio } = await escribir(modo, ["TRADER"]);

    expect((error as ErrorApi).estado).toBe(403);
    expect((error as ErrorApi).message).toContain("modo pánico");
    expect(siguio).toBe(false);
  });

  test("con el modo activo un AUDITOR también recibe 403", async () => {
    const { modo } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    expect(((await escribir(modo, ["AUDITOR"])).error as ErrorApi).estado).toBe(403);
  });

  test("con el modo activo el ADMIN SIGUE pudiendo escribir", async () => {
    const { modo } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    const { error, siguio } = await escribir(modo, ["ADMIN"]);

    expect(error).toBeUndefined();
    expect(siguio).toBe(true);
  });

  test("un usuario con varios roles que incluye ADMIN no se bloquea", async () => {
    const { modo } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    expect((await escribir(modo, ["TRADER", "ADMIN"])).siguio).toBe(true);
  });

  test("apagarlo vuelve a dejar escribir", async () => {
    const { modo } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");
    await modo.establecer({ activo: false }, "auth0|admin");

    expect((await escribir(modo, ["TRADER"])).siguio).toBe(true);
  });

  test("cada escritura bloqueada queda en el log", async () => {
    const { modo, lineas } = armar();
    await modo.establecer({ activo: true }, "auth0|admin");

    await escribir(modo, ["TRADER"], "auth0|ana");

    expect(lineas).toContain("[WARN] ModoPanico: Escritura bloqueada por el modo pánico: auth0|ana intentó POST /activos");
  });

  describe("FALLA CERRADO si no se puede leer el interruptor", () => {
    test("con Redis caído, un TRADER recibe 503 en lugar de poder escribir", async () => {
      const { modo, estado } = armar();
      estado.caido = true;

      const { error, siguio } = await escribir(modo, ["TRADER"]);

      expect((error as ErrorApi).estado).toBe(503);
      expect(siguio).toBe(false);
    });

    test("con Redis caído, un ADMIN igual puede escribir (ni siquiera se consulta Redis)", async () => {
      const { modo, estado, comandos } = armar();
      estado.caido = true;

      const { error, siguio } = await escribir(modo, ["ADMIN"]);

      expect(error).toBeUndefined();
      expect(siguio).toBe(true);
      expect(comandos).toEqual([]);
    });
  });

  test("la lectura del interruptor es un GET de una sola clave: lo ven todas las instancias", async () => {
    const { modo, comandos } = armar();

    await escribir(modo, ["TRADER"]);

    expect(comandos).toEqual([`GET ${CLAVE_MODO_PANICO}`]);
  });
});
