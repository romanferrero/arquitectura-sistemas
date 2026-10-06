import type { DatosActivo } from "../modelos/activo.ts";

/**
 * Resultado de una validacion: o hay datos limpios, o hay una lista de errores.
 * Se acumulan TODOS los errores en lugar de cortar en el primero, asi el
 * cliente ve de una sola vez todo lo que tiene que corregir.
 */
export type ResultadoValidacion =
  | { valido: true; datos: DatosActivo }
  | { valido: false; errores: string[] };

const SIMBOLO_VALIDO = /^[A-Z0-9]{1,10}$/;

/** Valida el formato de un simbolo suelto (usado por GET /api/precios/:simbolo). */
export function validarSimbolo(valor: string): string | undefined {
  const simbolo = valor.trim().toUpperCase();
  return SIMBOLO_VALIDO.test(simbolo) ? simbolo : undefined;
}

/**
 * Valida el body de POST y PUT.
 *
 * Recibe `unknown` (nunca `any`) porque el body llega del exterior y no hay
 * ninguna garantia sobre su forma: hay que comprobarla campo por campo.
 * Los campos desconocidos que venga en el body simplemente se ignoran.
 */
export function validarDatosActivo(cuerpo: unknown): ResultadoValidacion {
  const errores: string[] = [];

  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return { valido: false, errores: ["El cuerpo debe ser un objeto JSON"] };
  }

  const datos = cuerpo as Record<string, unknown>;

  // simbolo: string alfanumerico de 1 a 10 caracteres, normalizado a mayusculas.
  let simbolo = "";
  if (typeof datos["simbolo"] !== "string") {
    errores.push("simbolo es obligatorio y debe ser un texto");
  } else {
    const normalizado = datos["simbolo"].trim().toUpperCase();
    if (!SIMBOLO_VALIDO.test(normalizado)) {
      errores.push("simbolo debe tener entre 1 y 10 caracteres alfanuméricos (ej: BTC)");
    } else {
      simbolo = normalizado;
    }
  }

  // nombre: texto no vacio de hasta 50 caracteres.
  let nombre = "";
  if (typeof datos["nombre"] !== "string") {
    errores.push("nombre es obligatorio y debe ser un texto");
  } else {
    const normalizado = datos["nombre"].trim();
    if (normalizado.length === 0) {
      errores.push("nombre no puede estar vacío");
    } else if (normalizado.length > 50) {
      errores.push("nombre no puede superar los 50 caracteres");
    } else {
      nombre = normalizado;
    }
  }

  const cantidad = validarNumeroPositivo(datos["cantidad"], "cantidad", errores);
  const precioCompra = validarNumeroPositivo(datos["precioCompra"], "precioCompra", errores);

  if (errores.length > 0) return { valido: false, errores };

  return { valido: true, datos: { simbolo, nombre, cantidad, precioCompra } };
}

function validarNumeroPositivo(valor: unknown, campo: string, errores: string[]): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    errores.push(`${campo} es obligatorio y debe ser un número`);
    return 0;
  }
  if (valor <= 0) {
    errores.push(`${campo} debe ser mayor a 0`);
    return 0;
  }
  return valor;
}
