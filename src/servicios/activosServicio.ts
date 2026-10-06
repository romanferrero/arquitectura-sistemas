import { randomUUID } from "node:crypto";
import * as repositorio from "../datos/activosRepositorio.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";
import type { Activo, ActivoConPrecio } from "../modelos/activo.ts";
import { validarDatosActivo } from "../validaciones/activoValidacion.ts";
import { obtenerPrecio } from "./preciosServicio.ts";
import { env } from "../config/env.ts";

/**
 * Reglas de negocio del CRUD. Esta capa no conoce `req` ni `res`.
 *
 * Convencion que se mantiene en todo el archivo: el repositorio devuelve
 * `undefined` cuando no encuentra algo y el servicio es quien decide que eso
 * es un 404 lanzando un ErrorApi.
 */

export function listarActivos(simbolo?: string): Activo[] {
  const activos = repositorio.listar();
  if (simbolo === undefined) return activos;

  const buscado = simbolo.trim().toUpperCase();
  return activos.filter((activo) => activo.simbolo === buscado);
}

export function obtenerActivo(id: string): Activo {
  const activo = repositorio.buscarPorId(id);
  if (activo === undefined) {
    throw new ErrorApi(404, `No existe un activo con id ${id}`);
  }
  return activo;
}

export function crearActivo(cuerpo: unknown): Activo {
  const resultado = validarDatosActivo(cuerpo);
  if (!resultado.valido) {
    throw new ErrorApi(400, "Datos del activo inválidos", resultado.errores);
  }

  // Regla de negocio: una sola posicion por simbolo en el portafolio.
  const existente = repositorio.buscarPorSimbolo(resultado.datos.simbolo);
  if (existente !== undefined) {
    throw new ErrorApi(
      409,
      `Ya existe un activo con el símbolo ${resultado.datos.simbolo}`,
    );
  }

  const ahora = new Date().toISOString();
  return repositorio.guardar({
    id: randomUUID(),
    ...resultado.datos,
    creadoEn: ahora,
    actualizadoEn: ahora,
  });
}

export function actualizarActivo(id: string, cuerpo: unknown): Activo {
  const actual = obtenerActivo(id); // lanza 404 si no existe

  const resultado = validarDatosActivo(cuerpo);
  if (!resultado.valido) {
    throw new ErrorApi(400, "Datos del activo inválidos", resultado.errores);
  }

  // El simbolo puede cambiar, pero no puede pisar al de OTRO activo.
  const existente = repositorio.buscarPorSimbolo(resultado.datos.simbolo);
  if (existente !== undefined && existente.id !== id) {
    throw new ErrorApi(
      409,
      `Ya existe otro activo con el símbolo ${resultado.datos.simbolo}`,
    );
  }

  const actualizado: Activo = {
    id: actual.id, // el id nunca cambia, aunque venga en el body
    ...resultado.datos,
    creadoEn: actual.creadoEn, // la fecha de alta se conserva
    actualizadoEn: new Date().toISOString(),
  };

  repositorio.reemplazar(id, actualizado);
  return actualizado;
}

export function eliminarActivo(id: string): void {
  if (!repositorio.eliminar(id)) {
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
  const activo = obtenerActivo(id); // 404 si no existe
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

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
