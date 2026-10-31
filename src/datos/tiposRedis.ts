/**
 * Los comandos de Redis que usan los servicios de cache y de preferencias.
 *
 * Es un tipo propio (y no el del cliente `redis`) para que los servicios dependan
 * solo de lo que usan: en los tests se les pasa un Redis falso en memoria. El
 * cliente real cumple esta forma.
 */
export type ComandosRedis = {
  get(clave: string): Promise<string | null>;
  /**
   * Recorre las claves por tandas (SCAN): devuelve las de esta tanda y el cursor para pedir la siguiente;
   * el cursor "0" significa que ya se recorrio todo. A diferencia de KEYS, no bloquea Redis.
   */
  scan(cursor: string, opciones: { MATCH: string; COUNT: number }): Promise<{ cursor: string; keys: string[] }>;
  /** `EX` es el TTL en segundos. */
  set(clave: string, valor: string, opciones?: { EX: number }): Promise<unknown>;
  /** Borra una o varias claves y dice cuantas existian. */
  del(clave: string | string[]): Promise<number>;
  /** Suma uno de forma atomica y devuelve el nuevo valor (si la clave no existe, arranca en 0). */
  incr(clave: string): Promise<number>;
  zIncrBy(clave: string, incremento: number, miembro: string): Promise<number>;
  zRem(clave: string, miembro: string): Promise<number>;
  /** Miembros entre las posiciones `inicio` y `fin`; con `REV` van de mayor a menor puntaje. */
  zRangeWithScores(
    clave: string,
    inicio: number,
    fin: number,
    opciones?: { REV: true },
  ): Promise<{ value: string; score: number }[]>;
  hSet(clave: string, campos: Record<string, string>): Promise<number>;
  hGetAll(clave: string): Promise<Record<string, string>>;
};
