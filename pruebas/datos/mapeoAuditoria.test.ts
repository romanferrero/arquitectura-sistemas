import { describe, expect, test } from "@jest/globals";
import { documentoARegistro } from "../../src/datos/mapeoAuditoria.ts";
import type { DocumentoLeido } from "../../src/datos/mapeoAuditoria.ts";

const base: DocumentoLeido = {
  _id: { toString: () => "65f0c0ffee0123456789abcd" },
  operacion: "CREAR",
  entidad: "Activo",
  entidadId: "abc",
  ocurridoEn: new Date("2026-10-07T20:00:00.000Z"),
};

describe("documentoARegistro", () => {
  test("pasa _id a id (texto) y la fecha a texto ISO", () => {
    expect(documentoARegistro(base)).toEqual({
      id: "65f0c0ffee0123456789abcd",
      operacion: "CREAR",
      entidad: "Activo",
      entidadId: "abc",
      ocurridoEn: "2026-10-07T20:00:00.000Z",
    });
  });

  test("los campos opcionales ausentes no aparecen en el resultado", () => {
    const registro = documentoARegistro(base);

    expect(Object.keys(registro)).not.toContain("antes");
    expect(Object.keys(registro)).not.toContain("despues");
    expect(Object.keys(registro)).not.toContain("metadatos");
    expect(Object.keys(registro)).not.toContain("camposModificados");
  });

  test("conserva antes, despues, camposModificados y metadatos cuando existen", () => {
    const registro = documentoARegistro({
      ...base,
      operacion: "ACTUALIZAR",
      antes: { cantidad: 1 },
      despues: { cantidad: 2 },
      camposModificados: ["cantidad"],
      metadatos: { origen: "API" },
    });

    expect(registro).toMatchObject({
      operacion: "ACTUALIZAR",
      antes: { cantidad: 1 },
      despues: { cantidad: 2 },
      camposModificados: ["cantidad"],
      metadatos: { origen: "API" },
    });
  });

  test("una lista de campos modificados vacía se omite", () => {
    expect(documentoARegistro({ ...base, camposModificados: [] })).not.toHaveProperty("camposModificados");
  });
});
