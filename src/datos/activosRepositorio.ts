import { UniqueConstraintError } from "sequelize";
import type { Activo } from "../modelos/activo.ts";
import { filaAActivo, activoAFila } from "./mapeoActivo.ts";
import { ActivoModelo } from "./modelos/activoModelo.ts";

/**
 * Repositorio de activos sobre MySQL (Sequelize).
 *
 * Mantiene el contrato que tenia cuando guardaba en un array: las mismas
 * funciones, ahora asincronicas, que devuelven `Activo` del dominio y `undefined`
 * cuando algo no existe. Servicios y controladores no saben que hay una base.
 *
 * Todo lo que devuelve esta RELEIDO de la base despues de escribir: MySQL
 * redondea los DECIMAL en silencio (98.456 queda como 98.46) y el cliente tiene
 * que ver lo que realmente quedo guardado, no lo que mando.
 */

/**
 * El simbolo ya existe. Lo lanza el repositorio cuando MySQL rechaza la escritura
 * por la restriccion UNIQUE; el servicio decide que significa eso para el cliente.
 *
 * Confiar en la restriccion (y no en "buscar primero y guardar despues") es lo
 * unico seguro: dos pedidos simultaneos pueden pasar la comprobacion previa.
 */
export class SimboloDuplicadoError extends Error {
  readonly simbolo: string;

  constructor(simbolo: string) {
    super(`Ya existe un activo con el símbolo ${simbolo}`);
    this.name = "SimboloDuplicadoError";
    this.simbolo = simbolo;
  }
}

/** Convierte el error de la restriccion UNIQUE en el del repositorio; el resto sigue de largo. */
function traducir(error: unknown, simbolo: string): unknown {
  return error instanceof UniqueConstraintError ? new SimboloDuplicadoError(simbolo) : error;
}

/** Todos los activos, del mas viejo al mas nuevo; si se pasa un simbolo, solo ese. */
export async function listar(simbolo?: string): Promise<Activo[]> {
  const filas = await ActivoModelo.findAll({
    where: simbolo === undefined ? {} : { simbolo },
    order: [
      ["creadoEn", "ASC"],
      ["simbolo", "ASC"],
    ],
  });
  return filas.map((fila) => filaAActivo(fila.toJSON()));
}

export async function buscarPorId(id: string): Promise<Activo | undefined> {
  const fila = await ActivoModelo.findByPk(id);
  return fila === null ? undefined : filaAActivo(fila.toJSON());
}

export async function buscarPorSimbolo(simbolo: string): Promise<Activo | undefined> {
  const fila = await ActivoModelo.findOne({ where: { simbolo } });
  return fila === null ? undefined : filaAActivo(fila.toJSON());
}

/** Inserta el activo. Lanza SimboloDuplicadoError si el simbolo ya existe. */
export async function guardar(activo: Activo): Promise<Activo> {
  try {
    const creada = await ActivoModelo.create(activoAFila(activo));
    await creada.reload(); // lo que quedo en la base, ya redondeado por MySQL
    return filaAActivo(creada.toJSON());
  } catch (error) {
    throw traducir(error, activo.simbolo);
  }
}

/**
 * Reemplaza el activo completo. Devuelve undefined si el id no existe y lanza
 * SimboloDuplicadoError si el nuevo simbolo ya lo tiene otro activo.
 */
export async function reemplazar(id: string, activo: Activo): Promise<Activo | undefined> {
  const fila = await ActivoModelo.findByPk(id);
  if (fila === null) return undefined;

  try {
    const { id: _id, ...valores } = activoAFila({ ...activo, id });
    await fila.update(valores);
    await fila.reload();
    return filaAActivo(fila.toJSON());
  } catch (error) {
    throw traducir(error, activo.simbolo);
  }
}

/** Devuelve true si borro algo, false si el id no existia. */
export async function eliminar(id: string): Promise<boolean> {
  const borradas = await ActivoModelo.destroy({ where: { id } });
  return borradas > 0;
}
