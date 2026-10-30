/**
 * Los comandos de Redis que usan los servicios de cache y de preferencias.
 *
 * Es un tipo propio (y no el del cliente `redis`) para que los servicios dependan
 * solo de lo que usan: en los tests se les pasa un Redis falso en memoria. El
 * cliente real cumple esta forma.
 */
export type ComandosRedis = {
  get(clave: string): Promise<string | null>;
  /** `EX` es el TTL en segundos. */
  set(clave: string, valor: string, opciones?: { EX: number }): Promise<unknown>;
  del(clave: string): Promise<number>;
  zIncrBy(clave: string, incremento: number, miembro: string): Promise<number>;
  zRem(clave: string, miembro: string): Promise<number>;
  hSet(clave: string, campos: Record<string, string>): Promise<number>;
  hGetAll(clave: string): Promise<Record<string, string>>;
};
