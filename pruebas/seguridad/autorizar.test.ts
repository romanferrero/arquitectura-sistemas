import { describe, expect, test } from "@jest/globals";
import type { Request, Response } from "express";
import { ErrorApi } from "../../src/errores/ErrorApi.ts";
import type { Rol, Usuario } from "../../src/modelos/usuario.ts";
import { crearAutorizacion } from "../../src/seguridad/autorizar.ts";
import { guardarUsuario } from "../../src/seguridad/usuarioActual.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";

function armar() {
  const registro = crearRegistroEnMemoria();
  return { autorizar: crearAutorizacion(registro.registradorDe("Autorizacion")), lineas: registro.lineas };
}

/** Corre un middleware de autorizacion para un usuario con estos roles; devuelve el error (o undefined) y si siguio. */
function correr(verificar: ReturnType<ReturnType<typeof armar>["autorizar"]>, roles: Rol[], sub = "auth0|ana") {
  const res = { locals: {} } as unknown as Response;
  const usuario: Usuario = { sub, roles };
  guardarUsuario(res, usuario);
  let siguio = false;
  let error: unknown;
  try {
    verificar({ method: "DELETE", path: "/activos/1" } as unknown as Request, res, () => {
      siguio = true;
    });
  } catch (e) {
    error = e;
  }
  return { error, siguio };
}

describe("crearAutorizacion · la matriz de roles", () => {
  // Una fila por tipo de permiso de la aplicacion; una columna por rol. `true` = lo deja pasar.
  const matriz: [string, Rol[], Record<Rol, boolean>][] = [
    ["lectura (AUDITOR, TRADER, ADMIN)", ["AUDITOR", "TRADER", "ADMIN"], { AUDITOR: true, TRADER: true, ADMIN: true }],
    ["auditoría (AUDITOR, ADMIN)", ["AUDITOR", "ADMIN"], { AUDITOR: true, TRADER: false, ADMIN: true }],
    ["operación (TRADER, ADMIN)", ["TRADER", "ADMIN"], { AUDITOR: false, TRADER: true, ADMIN: true }],
    ["solo ADMIN", ["ADMIN"], { AUDITOR: false, TRADER: false, ADMIN: true }],
  ];

  describe.each(matriz)("%s", (_nombre, permitidos, esperado) => {
    test.each(["AUDITOR", "TRADER", "ADMIN"] as Rol[])("el rol %s", (rol) => {
      const { autorizar } = armar();

      const { error, siguio } = correr(autorizar(...permitidos), [rol]);

      if (esperado[rol]) {
        expect(error).toBeUndefined();
        expect(siguio).toBe(true);
      } else {
        expect(error).toBeInstanceOf(ErrorApi);
        expect((error as ErrorApi).estado).toBe(403);
        expect(siguio).toBe(false);
      }
    });
  });
});

describe("crearAutorizacion · otros casos", () => {
  test("un usuario válido SIN roles no pasa por ninguna ruta protegida (403, no 401)", () => {
    const { autorizar } = armar();

    const { error, siguio } = correr(autorizar("AUDITOR", "TRADER", "ADMIN"), []);

    expect((error as ErrorApi).estado).toBe(403);
    expect(siguio).toBe(false);
  });

  test("con varios roles alcanza con que UNO sea el permitido", () => {
    const { autorizar } = armar();

    expect(correr(autorizar("ADMIN"), ["AUDITOR", "ADMIN"]).siguio).toBe(true);
    expect(correr(autorizar("ADMIN"), ["AUDITOR", "TRADER"]).siguio).toBe(false);
  });

  test("el mensaje del 403 dice qué roles hacían falta", () => {
    const { autorizar } = armar();

    const { error } = correr(autorizar("TRADER", "ADMIN"), ["AUDITOR"]);

    expect((error as ErrorApi).message).toBe("No tiene permiso para esta operación. Roles necesarios: TRADER, ADMIN");
  });

  test("un acceso denegado queda en el log con quién, qué roles y qué intentó", () => {
    const { autorizar, lineas } = armar();

    correr(autorizar("ADMIN"), ["AUDITOR"], "auth0|ana");

    expect(lineas).toEqual(["[WARN] Autorizacion: Acceso denegado: auth0|ana (roles: AUDITOR) intentó DELETE /activos/1"]);
  });

  test("un acceso permitido no ensucia el log", () => {
    const { autorizar, lineas } = armar();

    correr(autorizar("AUDITOR"), ["AUDITOR"]);

    expect(lineas).toEqual([]);
  });

  test("en una ruta sin autenticación previa es un error de programación (no un 403)", () => {
    const { autorizar } = armar();
    const res = { locals: {} } as unknown as Response;

    expect(() => autorizar("ADMIN")({} as Request, res, () => undefined)).toThrow("no pasó por el middleware");
  });
});
