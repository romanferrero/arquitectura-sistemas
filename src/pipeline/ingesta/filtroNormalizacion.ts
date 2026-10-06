import type { Filtro } from "../pipeline.ts";
import type { ActivoEntrada, ActivoNormalizado } from "./tipos.ts";

/**
 * Segundo filtro: deja los textos en su forma canonica.
 *  - simbolo: sin espacios y en mayusculas ("  btc " -> "BTC").
 *  - nombre: sin espacios en los bordes ni repetidos adentro.
 *  - moneda: en mayusculas; si no vino, USD.
 *
 * Asume que la validacion ya paso: no vuelve a comprobar formatos.
 */
export const filtroNormalizacion: Filtro<ActivoEntrada, ActivoNormalizado> = {
  nombre: "FiltroNormalizacion",
  ejecutar(entrada, registrador) {
    const simbolo = entrada.simbolo.trim().toUpperCase();
    const nombre = entrada.nombre.trim().replace(/\s+/g, " ");
    const moneda = (entrada.moneda ?? "USD").trim().toUpperCase();

    registrador.info(`Símbolo ${simbolo} normalizado`);
    return {
      simbolo,
      nombre,
      cantidad: entrada.cantidad,
      precioCompra: entrada.precioCompra,
      moneda,
    };
  },
};
