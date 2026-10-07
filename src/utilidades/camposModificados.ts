/**
 * Cuales de los `campos` cambiaron de valor entre `antes` y `despues`.
 * Compara con igualdad estricta: sirve para los valores simples del activo
 * (texto y numeros), no para objetos anidados.
 */
export function camposModificados(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
  campos: readonly string[],
): string[] {
  return campos.filter((campo) => antes[campo] !== despues[campo]);
}
