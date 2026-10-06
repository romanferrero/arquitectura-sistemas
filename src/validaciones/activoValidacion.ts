const SIMBOLO_VALIDO = /^[A-Z0-9]{1,10}$/;

/**
 * Valida el formato de un simbolo y lo devuelve normalizado (sin espacios y en
 * mayusculas), o undefined si no es valido.
 *
 * Lo usan GET /api/precios/:simbolo y el filtro de validacion del pipeline de
 * ingesta. La validacion del body completo vive en ese filtro.
 */
export function validarSimbolo(valor: string): string | undefined {
  const simbolo = valor.trim().toUpperCase();
  return SIMBOLO_VALIDO.test(simbolo) ? simbolo : undefined;
}
