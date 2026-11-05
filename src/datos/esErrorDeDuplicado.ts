/**
 * MongoDB rechaza con el codigo 11000 (E11000) lo que viola un indice unico. Se reconoce por el
 * codigo y no por el texto del mensaje, que cambia entre versiones del driver.
 */
export function esErrorDeDuplicado(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}
