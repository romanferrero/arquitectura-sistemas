import type { Activo } from "../modelos/activo.ts";

/**
 * ALMACENAMIENTO TEMPORAL EN MEMORIA.
 *
 * Este array es el unico estado de la aplicacion y vive solamente dentro de
 * este archivo: ninguna otra capa lo toca. Los datos se pierden cada vez que
 * se reinicia el proceso.
 *
 * Al estar aislado aca, migrar a una base de datos implicaria reescribir SOLO
 * este archivo, sin tocar servicios, controladores ni rutas.
 */
const activos: Activo[] = [];

/** Devuelve una copia para que nadie modifique el array original desde afuera. */
export function listar(): Activo[] {
  return [...activos];
}

export function buscarPorId(id: string): Activo | undefined {
  return activos.find((activo) => activo.id === id);
}

export function buscarPorSimbolo(simbolo: string): Activo | undefined {
  return activos.find((activo) => activo.simbolo === simbolo);
}

export function guardar(activo: Activo): Activo {
  activos.push(activo);
  return activo;
}

/** Reemplaza el activo completo. Devuelve undefined si el id no existe. */
export function reemplazar(id: string, activo: Activo): Activo | undefined {
  const indice = activos.findIndex((item) => item.id === id);
  if (indice === -1) return undefined;
  activos[indice] = activo;
  return activo;
}

/** Devuelve true si borro algo, false si el id no existia. */
export function eliminar(id: string): boolean {
  const indice = activos.findIndex((activo) => activo.id === id);
  if (indice === -1) return false;
  activos.splice(indice, 1);
  return true;
}
