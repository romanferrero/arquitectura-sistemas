import { describe, expect, test } from "@jest/globals";
import {
  CANAL_ACTIVOS,
  EventoInvalidoError,
  TIPOS_EVENTO_ACTIVO,
  VERSION_EVENTO,
  parsearEventoActivo,
} from "../../src/eventos/eventoActivo.ts";

const activo = {
  id: "id-btc",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 30000,
  creadoEn: "2026-11-04T10:00:00.000Z",
  actualizadoEn: "2026-11-04T10:00:00.000Z",
};

const base = {
  version: VERSION_EVENTO,
  idEvento: "8f509a2c-d7d1-4cf8-a0a8-f422bb0c3e83",
  activoId: "id-btc",
  metadatos: { origen: "API", usuario: "auth0|ana" },
  ocurridoEn: "2026-11-04T10:00:00.000Z",
};

const creado = { ...base, tipo: "ACTIVO_CREADO", despues: activo };
const actualizado = { ...base, tipo: "ACTIVO_ACTUALIZADO", antes: activo, despues: { ...activo, cantidad: 2 }, camposModificados: ["cantidad"] };
const eliminado = { ...base, tipo: "ACTIVO_ELIMINADO", antes: activo };

function conMensaje(evento: unknown): string {
  return JSON.stringify(evento);
}

describe("el contrato del evento de activo", () => {
  test("el canal y la versión son los acordados", () => {
    expect(CANAL_ACTIVOS).toBe("activos-actualizaciones");
    expect(VERSION_EVENTO).toBe(1);
    expect(TIPOS_EVENTO_ACTIVO).toEqual(["ACTIVO_CREADO", "ACTIVO_ACTUALIZADO", "ACTIVO_ELIMINADO"]);
  });

  test.each([
    ["creado", creado],
    ["actualizado", actualizado],
    ["eliminado", eliminado],
  ])("un evento %s válido se lee tal cual", (_nombre, evento) => {
    expect(parsearEventoActivo(conMensaje(evento))).toEqual(evento);
  });

  test("la conversión de moneda viaja en los metadatos", () => {
    const evento = { ...creado, metadatos: { origen: "API", usuario: "auth0|ana", conversionMoneda: { monedaOriginal: "EUR", precioOriginal: 100, tasa: 1.1 } } };

    expect(parsearEventoActivo(conMensaje(evento)).metadatos.conversionMoneda).toEqual({ monedaOriginal: "EUR", precioOriginal: 100, tasa: 1.1 });
  });

  test("el usuario de los metadatos es opcional", () => {
    expect(() => parsearEventoActivo(conMensaje({ ...creado, metadatos: { origen: "API" } }))).not.toThrow();
  });

  describe("lo que cada tipo tiene que traer", () => {
    test("un ACTIVO_CREADO sin `despues` es inválido", () => {
      expect(() => parsearEventoActivo(conMensaje({ ...creado, despues: undefined }))).toThrow(/ACTIVO_CREADO requiere "despues"/);
    });

    test("un ACTIVO_ELIMINADO sin `antes` es inválido", () => {
      expect(() => parsearEventoActivo(conMensaje({ ...eliminado, antes: undefined }))).toThrow(/ACTIVO_ELIMINADO requiere "antes"/);
    });

    test("un ACTIVO_ACTUALIZADO necesita `antes` y `despues`", () => {
      expect(() => parsearEventoActivo(conMensaje({ ...actualizado, antes: undefined }))).toThrow(/requiere "antes"/);
      expect(() => parsearEventoActivo(conMensaje({ ...actualizado, despues: undefined }))).toThrow(/requiere "despues"/);
    });
  });

  describe("mensajes que no cumplen el contrato", () => {
    test.each([
      ["no es JSON", "esto no es json", /no es un JSON válido/],
      ["es un JSON que no es un objeto", "42", /no cumple el contrato/],
      ["el tipo es desconocido", conMensaje({ ...creado, tipo: "ACTIVO_TELETRANSPORTADO" }), /tipo/],
      ["la versión es otra", conMensaje({ ...creado, version: 2 }), /version/],
      ["el id del evento no es un UUID", conMensaje({ ...creado, idEvento: "123" }), /idEvento/],
      ["falta el activoId", conMensaje({ ...creado, activoId: undefined }), /activoId/],
      ["la fecha no es ISO", conMensaje({ ...creado, ocurridoEn: "ayer" }), /ocurridoEn/],
      ["faltan los metadatos", conMensaje({ ...creado, metadatos: undefined }), /metadatos/],
      ["el activo trae la cantidad como texto", conMensaje({ ...creado, despues: { ...activo, cantidad: "1" } }), /despues\.cantidad/],
    ])("rechaza el que %s", (_descripcion, mensaje, patron) => {
      expect(() => parsearEventoActivo(mensaje)).toThrow(EventoInvalidoError);
      expect(() => parsearEventoActivo(mensaje)).toThrow(patron);
    });

    test("el error dice todos los problemas juntos", () => {
      expect(() => parsearEventoActivo(conMensaje({ ...creado, version: 9, activoId: "" }))).toThrow(/version.*activoId|activoId.*version/);
    });
  });
});
