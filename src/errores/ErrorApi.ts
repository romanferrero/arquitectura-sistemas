/**
 * Error de aplicacion que ya sabe con que codigo HTTP debe responderse.
 *
 * Cualquier capa puede lanzarlo (`throw new ErrorApi(404, "...")`) y el
 * middleware manejadorErrores lo traduce a una respuesta JSON. Asi el mapeo
 * error -> codigo HTTP queda en un unico lugar.
 */
export class ErrorApi extends Error {
  readonly estado: number;
  readonly detalles: string[] | undefined;

  constructor(estado: number, mensaje: string, detalles?: string[]) {
    super(mensaje);
    this.name = "ErrorApi";
    this.estado = estado;
    this.detalles = detalles;
  }
}
