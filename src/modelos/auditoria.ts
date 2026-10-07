/** Que se hizo con el activo. */
export const OPERACIONES_AUDITORIA = ["CREAR", "ACTUALIZAR", "ELIMINAR"] as const;
export type OperacionAuditoria = (typeof OPERACIONES_AUDITORIA)[number];

/**
 * Un registro del historial: que operacion se hizo sobre un activo y como era
 * antes y despues. Los tres campos libres (`antes`, `despues`, `metadatos`) no
 * tienen forma fija: un CREAR solo trae `despues`, un ELIMINAR solo `antes`, y
 * `metadatos` guarda lo propio de cada caso (por ejemplo la conversion de moneda).
 */
export type RegistroAuditoria = {
  id: string;
  operacion: OperacionAuditoria;
  entidad: "Activo";
  entidadId: string;
  antes?: Record<string, unknown>;
  despues?: Record<string, unknown>;
  /** Solo en ACTUALIZAR: que campos cambiaron. */
  camposModificados?: string[];
  metadatos?: Record<string, unknown>;
  ocurridoEn: string;
};

/** Lo que el servicio le pide guardar al repositorio: el resto lo completa el repositorio. */
export type NuevoRegistroAuditoria = Omit<RegistroAuditoria, "id" | "entidad" | "ocurridoEn">;

/** Filtros de la consulta del historial general. */
export type FiltroAuditoria = {
  operacion?: OperacionAuditoria;
  limite: number;
};
