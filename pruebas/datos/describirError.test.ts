import { describe, expect, test } from "@jest/globals";
import { describirError } from "../../src/datos/describirError.ts";

describe("describirError", () => {
  test("incluye el nombre y el mensaje de un error común", () => {
    expect(describirError(new TypeError("algo falló"))).toBe("TypeError: algo falló");
  });

  test("un error de conexión con mensaje vacío muestra el nombre y el código", () => {
    // Asi llegan los errores de Sequelize cuando no hay nadie escuchando en el puerto.
    const error = Object.assign(new Error(""), {
      name: "SequelizeConnectionRefusedError",
      parent: { code: "ECONNREFUSED" },
    });

    expect(describirError(error)).toBe("SequelizeConnectionRefusedError: ECONNREFUSED");
  });

  test("incluye el código del error original aunque haya mensaje", () => {
    const error = Object.assign(new Error("acceso denegado"), {
      name: "SequelizeAccessDeniedError",
      parent: { code: "ER_ACCESS_DENIED_ERROR" },
    });

    expect(describirError(error)).toBe(
      "SequelizeAccessDeniedError: acceso denegado: ER_ACCESS_DENIED_ERROR",
    );
  });

  test("un valor que no es un Error se convierte a texto", () => {
    expect(describirError("falló")).toBe("falló");
    expect(describirError(42)).toBe("42");
  });
});
