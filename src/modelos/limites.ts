/**
 * Rango de valores que admite la tabla `activos`.
 *
 * Las columnas son DECIMAL: `cantidad` guarda 8 decimales y `precio_compra` 2,
 * y MySQL redondea en silencio lo que tenga mas. Un valor positivo pero chico
 * (cantidad 0.000000001) se redondearia a 0, violaria el CHECK de la tabla y
 * terminaria en un error 500. Por eso la validacion rechaza de antemano lo que
 * la base no puede representar.
 */
export const CANTIDAD_MINIMA = 0.00000001;
export const PRECIO_MINIMO = 0.01;

/** Tope comun, muy por debajo de lo que entran las columnas (16 y 18 enteros). */
export const VALOR_MAXIMO = 1e15;
