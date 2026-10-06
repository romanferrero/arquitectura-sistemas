import type { FabricaRegistrador, Registrador } from "../../src/pipeline/pipeline.ts";

/**
 * Registrador falso para los tests: en lugar de escribir en consola, guarda en
 * memoria cada linea con el mismo formato que muestra el logger real
 * ("[INFO] Origen: mensaje"), asi se puede comprobar que se logueo y en que orden.
 */
export function crearRegistroEnMemoria() {
  const lineas: string[] = [];
  const registradorDe: FabricaRegistrador = (origen) => ({
    info: (mensaje) => lineas.push(`[INFO] ${origen}: ${mensaje}`),
    error: (mensaje) => lineas.push(`[ERROR] ${origen}: ${mensaje}`),
  });
  return { lineas, registradorDe };
}

/** Registrador que descarta todo, para los tests que no miran los logs. */
export const registradorSilencioso: Registrador = {
  info: () => undefined,
  error: () => undefined,
};
