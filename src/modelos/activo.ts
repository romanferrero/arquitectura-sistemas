/** Un activo del portafolio, tal como se guarda y se devuelve al cliente. */
export type Activo = {
  id: string;
  simbolo: string;
  nombre: string;
  cantidad: number;
  precioCompra: number;
  creadoEn: string;
  actualizadoEn: string;
};

/**
 * Los campos que el cliente puede enviar en POST y PUT.
 * El id y las fechas los genera siempre el servidor, por eso se excluyen.
 */
export type DatosActivo = Omit<Activo, "id" | "creadoEn" | "actualizadoEn">;

/** Respuesta del endpoint de precio: el activo + la cotizacion y su rendimiento. */
export type ActivoConPrecio = Activo & {
  precioActual: number;
  moneda: string;
  valorActual: number;
  costoTotal: number;
  gananciaPerdida: number;
  variacionPorcentual: number;
  consultadoEn: string;
};
