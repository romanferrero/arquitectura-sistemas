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
