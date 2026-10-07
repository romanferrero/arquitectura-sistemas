import { UniqueConstraintError } from "sequelize";
import type { Activo } from "../modelos/activo.ts";
import { sequelize } from "./conexiones.ts";
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
 * Reemplaza el activo completo. Devuelve el activo como estaba JUSTO ANTES de
 * reemplazarlo y como quedo, o undefined si el id no existe. Lanza
 * SimboloDuplicadoError si el nuevo simbolo ya lo tiene otro activo.
 *
 * Leer y escribir ocurren en una transaccion con la fila bloqueada (SELECT ... FOR
 * UPDATE): si dos PUT llegan a la vez, el segundo espera al primero. Asi el "antes"
 * que se devuelve es de verdad lo que se piso (y es lo que va a la auditoria), y no
 * una lectura vieja de antes de que otro lo modificara.
 */
export async function reemplazar(
  id: string,
  activo: Activo,
): Promise<{ antes: Activo; despues: Activo } | undefined> {
  try {
    return await sequelize.transaction(async (transaccion) => {
      const fila = await ActivoModelo.findByPk(id, { transaction: transaccion, lock: transaccion.LOCK.UPDATE });
      if (fila === null) return undefined;

      const antes = filaAActivo(fila.toJSON());
      // La fecha de alta nunca cambia: se conserva la que esta guardada.
      const { id: _id, ...valores } = activoAFila({ ...activo, id, creadoEn: antes.creadoEn });
      await fila.update(valores, { transaction: transaccion });
      await fila.reload({ transaction: transaccion });
      return { antes, despues: filaAActivo(fila.toJSON()) };
    });
  } catch (error) {
    throw traducir(error, activo.simbolo);
  }
}

/** Devuelve true si borro algo, false si el id no existia. */
export async function eliminar(id: string): Promise<boolean> {
  const borradas = await ActivoModelo.destroy({ where: { id } });
  return borradas > 0;
}
