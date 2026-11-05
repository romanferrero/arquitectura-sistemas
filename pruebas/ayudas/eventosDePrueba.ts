import type { EventoActivo } from "../../src/eventos/eventoActivo.ts";

/** Eventos de ejemplo ya validos, para los tests de los suscriptores. */
export const activoDePrueba = {
  id: "id-btc",
  simbolo: "BTC",
  nombre: "Bitcoin",
  cantidad: 0.5,
  precioCompra: 30000,
  creadoEn: "2026-11-04T10:00:00.000Z",
  actualizadoEn: "2026-11-04T10:00:00.000Z",
};

const base = {
  version: 1,
  idEvento: "8f509a2c-d7d1-4cf8-a0a8-f422bb0c3e83",
  activoId: "id-btc",
  metadatos: { origen: "API", usuario: "auth0|ana" },
  ocurridoEn: "2026-11-04T10:00:00.000Z",
} as const;

export const eventoCreado: EventoActivo = { ...base, tipo: "ACTIVO_CREADO", despues: activoDePrueba };

export const eventoActualizado: EventoActivo = {
  ...base,
  tipo: "ACTIVO_ACTUALIZADO",
  antes: activoDePrueba,
  despues: { ...activoDePrueba, cantidad: 2 },
  camposModificados: ["cantidad"],
};

export const eventoEliminado: EventoActivo = { ...base, tipo: "ACTIVO_ELIMINADO", antes: activoDePrueba };
