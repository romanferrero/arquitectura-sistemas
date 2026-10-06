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
 *  - lo que no es un objeto, o no trae un simbolo de texto;
 *  - cantidad o precioCompra que no son numeros, o son cero o negativos;
 *  - una volatilidad informada que no es un numero >= 0.
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

  const simbolo = datos["simbolo"];
  if (typeof simbolo !== "string" || simbolo.trim() === "") {
    return { conservado: false, motivo: "simbolo es obligatorio y debe ser un texto" };
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

  const volatilidad = datos["volatilidad"];
  if (
    volatilidad !== undefined &&
    (typeof volatilidad !== "number" || !Number.isFinite(volatilidad) || volatilidad < 0)
  ) {
    return { conservado: false, motivo: "volatilidad debe ser un número mayor o igual a 0" };
  }

  return {
    conservado: true,
    activo: {
      simbolo: simbolo.trim().toUpperCase(), // igual que en el resto de la API
      nombre: typeof datos["nombre"] === "string" ? datos["nombre"].trim() : undefined,
      cantidad,
      precioCompra,
      volatilidad,
    },
  };
}
