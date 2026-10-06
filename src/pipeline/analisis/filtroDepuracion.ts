import { validarSimbolo } from "../../validaciones/activoValidacion.ts";
import type { Filtro } from "../pipeline.ts";
import type { ActivoAnalizable, LoteDepurado } from "./tipos.ts";

type Depurado = { conservado: true; activo: ActivoAnalizable } | { conservado: false; motivo: string };

/**
 * Primer filtro del analisis (Scrubbing): descarta lo que no se puede analizar.
 *
 * Se descarta, y NO se rechaza el lote con un error: un elemento malo no
 * invalida a los demas. Cada descarte queda en el log con su indice y motivo.
 *
 * Que se descarta:
 *  - lo que no es un objeto;
 *  - un simbolo que no cumple la regla de la ingesta (texto alfanumerico de 1 a
 *    10 caracteres) o un nombre de mas de 50 caracteres;
 *  - cantidad o precioCompra que no son numeros, o son cero o negativos;
 *  - un monto (cantidad x precioCompra) tan grande que desborda a Infinity;
 *  - una volatilidad informada que no es un numero >= 0. Un `null` cuenta como
 *    "no informada": es como muchos clientes serializan un campo opcional vacio.
 *
 * Importante: se mira cada factor por separado. El monto (cantidad x precio)
 * de dos negativos da positivo, y ese activo igual seria invalido.
 */
export const filtroDepuracion: Filtro<unknown[], LoteDepurado> = {
  nombre: "FiltroDepuracion",
  ejecutar(entrada, registrador) {
    const activos: ActivoAnalizable[] = [];

    entrada.forEach((elemento, indice) => {
      const resultado = depurar(elemento);
      if (resultado.conservado) {
        activos.push(resultado.activo);
      } else {
        registrador.info(`Descartado el elemento ${indice}: ${resultado.motivo}`);
      }
    });

    registrador.info(`${activos.length} de ${entrada.length} activos conservados`);
    return { recibidos: entrada.length, activos };
  },
};

function depurar(elemento: unknown): Depurado {
  if (typeof elemento !== "object" || elemento === null || Array.isArray(elemento)) {
    return { conservado: false, motivo: "no es un objeto" };
  }
  const datos = elemento as Record<string, unknown>;

  const simboloCrudo = datos["simbolo"];
  if (typeof simboloCrudo !== "string") {
    return { conservado: false, motivo: "simbolo es obligatorio y debe ser un texto" };
  }
  const simbolo = validarSimbolo(simboloCrudo); // ya sale sin espacios y en mayusculas
  if (simbolo === undefined) {
    return {
      conservado: false,
      motivo: "simbolo debe tener entre 1 y 10 caracteres alfanuméricos (ej: BTC)",
    };
  }

  const nombre = typeof datos["nombre"] === "string" ? datos["nombre"].trim() : undefined;
  if (nombre !== undefined && nombre.length > 50) {
    return { conservado: false, motivo: "nombre no puede superar los 50 caracteres" };
  }

  const cantidad = datos["cantidad"];
  if (typeof cantidad !== "number" || !Number.isFinite(cantidad)) {
    return { conservado: false, motivo: "cantidad debe ser un número" };
  }
  if (cantidad <= 0) {
    return { conservado: false, motivo: "cantidad debe ser mayor a 0" };
  }

  const precioCompra = datos["precioCompra"];
  if (typeof precioCompra !== "number" || !Number.isFinite(precioCompra)) {
    return { conservado: false, motivo: "precioCompra debe ser un número" };
  }
  if (precioCompra <= 0) {
    return { conservado: false, motivo: "precioCompra debe ser mayor a 0" };
  }

  // Dos factores finitos pueden dar un producto infinito (1e200 x 1e200).
  if (!Number.isFinite(cantidad * precioCompra)) {
    return { conservado: false, motivo: "el monto (cantidad x precioCompra) es demasiado grande" };
  }

  const volatilidadCruda = datos["volatilidad"];
  let volatilidad: number | undefined;
  if (volatilidadCruda !== undefined && volatilidadCruda !== null) {
    if (typeof volatilidadCruda !== "number" || !Number.isFinite(volatilidadCruda) || volatilidadCruda < 0) {
      return { conservado: false, motivo: "volatilidad debe ser un número mayor o igual a 0" };
    }
    volatilidad = volatilidadCruda;
  }

  return { conservado: true, activo: { simbolo, nombre, cantidad, precioCompra, volatilidad } };
}
