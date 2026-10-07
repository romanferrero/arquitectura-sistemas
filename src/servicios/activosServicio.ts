import { randomUUID } from "node:crypto";
import * as repositorio from "../datos/activosRepositorio.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Activo, ActivoConPrecio } from "../modelos/activo.ts";
import { crearPipelineIngesta } from "../pipeline/ingesta/pipelineIngesta.ts";
import { obtenerPrecio } from "./preciosServicio.ts";
import { obtenerTasaAUsd } from "./tasasServicio.ts";
import { env } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { redondear } from "../utilidades/redondear.ts";

/**
 * Reglas de negocio del CRUD. Esta capa no conoce `req` ni `res`.
 *
 * Convencion que se mantiene en todo el archivo: el repositorio devuelve
 * `undefined` cuando no encuentra algo y el servicio es quien decide que eso
 * es un 404 lanzando un ErrorApi.
 */

// Validacion, normalizacion y conversion de moneda: todo lo que le pasa a un
// activo antes de guardarse. Aca se le conectan el logger y la API de tasas.
const pipelineIngesta = crearPipelineIngesta({ registradorDe, obtenerTasa: obtenerTasaAUsd });

export async function listarActivos(simbolo?: string): Promise<Activo[]> {
  // El filtro se resuelve en la base (WHERE), no trayendo todo para filtrar aca.
  return await repositorio.listar(simbolo?.trim().toUpperCase());
}

export async function obtenerActivo(id: string): Promise<Activo> {
  const activo = await repositorio.buscarPorId(id);
  if (activo === undefined) {
    throw new ErrorApi(404, `No existe un activo con id ${id}`);
  }
  return activo;
}

// Es async porque el pipeline puede consultar la API de tasas de cambio.
export async function crearActivo(cuerpo: unknown): Promise<Activo> {
  const { datos } = await pipelineIngesta.ejecutar(cuerpo); // 400 / 502 si falla un filtro

  // Regla de negocio: una sola posicion por simbolo en el portafolio. La hace
  // cumplir la restriccion UNIQUE de la base: no se busca antes, porque dos
  // pedidos simultaneos podrian pasar esa comprobacion a la vez.
  const ahora = new Date().toISOString();
  try {
    return await repositorio.guardar({
      id: randomUUID(),
      ...datos,
      creadoEn: ahora,
      actualizadoEn: ahora,
    });
  } catch (error) {
    if (error instanceof repositorio.SimboloDuplicadoError) {
      throw new ErrorApi(409, `Ya existe un activo con el símbolo ${datos.simbolo}`);
    }
    throw error;
  }
}

export async function actualizarActivo(id: string, cuerpo: unknown): Promise<Activo> {
  await obtenerActivo(id); // 404 enseguida si no existe, sin gastar el pipeline

  const { datos } = await pipelineIngesta.ejecutar(cuerpo); // 400 / 502 si falla un filtro

  // Se vuelve a leer: mientras el pipeline esperaba a la API de tasas el activo
  // pudo borrarse o modificarse, y no hay que pisarlo con datos viejos.
  const actual = await obtenerActivo(id);

  const actualizado: Activo = {
    id: actual.id, // el id nunca cambia, aunque venga en el body
    ...datos,
    creadoEn: actual.creadoEn, // la fecha de alta se conserva
    actualizadoEn: new Date().toISOString(),
  };

  // El simbolo puede cambiar, pero no puede pisar al de OTRO activo: lo
  // garantiza la restriccion UNIQUE de la base.
  try {
    const guardado = await repositorio.reemplazar(id, actualizado);
    if (guardado === undefined) {
      throw new ErrorApi(404, `No existe un activo con id ${id}`); // se borro mientras tanto
    }
    return guardado; // lo que quedo en la base, no lo que se intento guardar
  } catch (error) {
    if (error instanceof repositorio.SimboloDuplicadoError) {
      throw new ErrorApi(409, `Ya existe otro activo con el símbolo ${datos.simbolo}`);
    }
    throw error;
  }
}

export async function eliminarActivo(id: string): Promise<void> {
  if (!(await repositorio.eliminar(id))) {
    throw new ErrorApi(404, `No existe un activo con id ${id}`);
  }
}

/**
 * Combina el activo guardado con su cotizacion actual y calcula el
 * rendimiento de la posicion.
 *
 * Es async porque consulta la API externa; Express 5 propaga solo el rechazo
 * de la promesa al manejador de errores.
 */
export async function obtenerActivoConPrecio(id: string): Promise<ActivoConPrecio> {
  const activo = await obtenerActivo(id); // 404 si no existe
  const precioActual = await obtenerPrecio(activo.simbolo); // 502 si falla la API

  const valorActual = activo.cantidad * precioActual;
  const costoTotal = activo.cantidad * activo.precioCompra;
  const gananciaPerdida = valorActual - costoTotal;

  return {
    ...activo,
    precioActual,
    moneda: env.MONEDA,
    valorActual: redondear(valorActual),
    costoTotal: redondear(costoTotal),
    gananciaPerdida: redondear(gananciaPerdida),
    variacionPorcentual: redondear((gananciaPerdida / costoTotal) * 100),
    consultadoEn: new Date().toISOString(),
  };
}
