import type { Activo } from "../modelos/activo.ts";
import type { ActivoFila } from "./modelos/activoModelo.ts";

/**
 * Traduccion entre el `Activo` del dominio y la fila de la tabla.
 *
 * Son funciones puras (sin base de datos) a proposito: concentran las dos
 * diferencias de representacion y se pueden probar sin levantar MySQL.
 *
 *  - Numeros: el dominio usa `number`; la columna DECIMAL viaja como texto.
 *  - Fechas:  el dominio usa texto ISO; la columna es un `Date`.
 */

/** De la fila (DECIMAL como texto, fechas como Date) al Activo que ve el resto de la app. */
export function filaAActivo(fila: ActivoFila): Activo {
  return {
    id: fila.id,
    simbolo: fila.simbolo,
    nombre: fila.nombre,
    cantidad: Number(fila.cantidad),
    precioCompra: Number(fila.precioCompra),
    creadoEn: fila.creadoEn.toISOString(),
    actualizadoEn: fila.actualizadoEn.toISOString(),
  };
}

/**
 * Del Activo a la fila. Los numeros se pasan ya redondeados a la escala de la
 * columna (8 decimales la cantidad, 2 el precio): es lo que MySQL haria igual
 * en silencio, y asi el redondeo queda explicito en el codigo.
 *
 * toFixed no produce notacion cientifica porque la validacion acota los valores
 * (ver modelos/limites.ts).
 */
export function activoAFila(activo: Activo): ActivoFila {
  return {
    id: activo.id,
    simbolo: activo.simbolo,
    nombre: activo.nombre,
    cantidad: activo.cantidad.toFixed(8),
    precioCompra: activo.precioCompra.toFixed(2),
    creadoEn: new Date(activo.creadoEn),
    actualizadoEn: new Date(activo.actualizadoEn),
  };
}
