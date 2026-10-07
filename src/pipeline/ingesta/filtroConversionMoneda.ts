import { ErrorApi } from "../../errores/ErrorApi.ts";
import { VALOR_MAXIMO } from "../../modelos/limites.ts";
import type { ObtenerTasa } from "../../servicios/tasasServicio.ts";
import { redondear } from "../../utilidades/redondear.ts";
import type { Filtro } from "../pipeline.ts";
import type { ActivoIngestado, ActivoNormalizado } from "./tipos.ts";

const MONEDA_BASE = "USD";

/**
 * Tercer filtro: lleva el precio de compra a USD.
 *
 * Si el activo ya viene en USD no consulta nada. Si viene en otra moneda pide
 * la tasa (cuanto vale 1 unidad de esa moneda en USD) y convierte, con dos
 * decimales.
 *
 * Es una FABRICA porque necesita una dependencia externa: la funcion que
 * obtiene la tasa. En la aplicacion se le pasa la que llama a la API; en los
 * tests, una falsa, y asi se prueba sin red.
 */
export function crearFiltroConversionMoneda(dependencias: {
  obtenerTasa: ObtenerTasa;
}): Filtro<ActivoNormalizado, ActivoIngestado> {
  return {
    nombre: "FiltroConversionMoneda",
    async ejecutar(entrada, registrador) {
      const { moneda, ...datos } = entrada;

      if (moneda === MONEDA_BASE) {
        registrador.info(`Sin conversión: el precio ya está en ${MONEDA_BASE}`);
        return { datos, conversion: undefined };
      }

      const tasa = await dependencias.obtenerTasa(moneda);
      const precioConvertido = redondear(entrada.precioCompra * tasa);

      // Con dos decimales, un precio diminuto en una moneda muy chica puede
      // quedar en cero, y un activo con precio 0 no es valido.
      if (precioConvertido <= 0) {
        throw new ErrorApi(
          400,
          `El precio convertido a ${MONEDA_BASE} es menor a 0.01; revisá precioCompra y moneda`,
        );
      }

      // Y al reves: con una tasa alta el precio convertido puede no entrar en la tabla.
      if (precioConvertido > VALOR_MAXIMO) {
        throw new ErrorApi(
          400,
          `El precio convertido a ${MONEDA_BASE} supera el máximo permitido (${VALOR_MAXIMO})`,
        );
      }

      registrador.info(
        `Convertido ${entrada.precioCompra} ${moneda} a ${precioConvertido} ${MONEDA_BASE} (tasa ${tasa})`,
      );
      return {
        datos: { ...datos, precioCompra: precioConvertido },
        conversion: { monedaOriginal: moneda, precioOriginal: entrada.precioCompra, tasa },
      };
    },
  };
}
