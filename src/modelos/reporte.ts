/** Una posicion del portafolio valuada a precio de mercado. */
export type PosicionValuada = {
  simbolo: string;
  nombre: string;
  cantidad: number;
  precioCompra: number;
  precioActual: number;
  costo: number;
  valorActual: number;
  gananciaPerdida: number;
  variacionPorcentual: number;
};

/**
 * Reporte de Valoracion Masiva: todo el portafolio valuado de una vez. Lo genera el
 * worker, fuera del ciclo de la peticion, y queda guardado en el resultado del trabajo.
 */
export type ReporteValoracion = {
  generadoEn: string;
  moneda: string;
  resumen: {
    activos: number;
    valuados: number;
    sinPrecio: number;
    costoTotal: number;
    valorActual: number;
    gananciaPerdida: number;
    variacionPorcentual: number;
  };
  posiciones: PosicionValuada[];
  /** Simbolos que no se pudieron cotizar (no soportados o sin dato). No cuentan en los totales. */
  sinPrecio: string[];
};

/** Datos que viajan en el trabajo de la cola. */
export type DatosReporte = {
  idReporte: string;
  solicitadoEn: string;
  /**
   * Quien lo pidio (el `sub` del token): queda en la auditoria del reporte. Es opcional porque los
   * trabajos que ya estaban en la cola antes de agregar la autenticacion no lo traen.
   */
  solicitadoPor?: string;
};

/** Estados que ve el cliente; la cola tiene mas y se resumen en estos cuatro. */
export const ESTADOS_REPORTE = ["en_cola", "procesando", "completado", "fallido"] as const;
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number];

/** Lo que devuelve GET /api/reportes/:id. */
export type SeguimientoReporte = {
  idReporte: string;
  estado: EstadoReporte;
  /** 0 a 100, mientras se procesa. */
  progreso: number;
  solicitadoEn?: string;
  solicitadoPor?: string;
  /** Cuantas veces se intento procesar (la cola reintenta los fallos). */
  intentos: number;
  /** Solo cuando esta `completado`. */
  resultado?: ReporteValoracion;
  /** Solo cuando esta `fallido`: por que fallo el ultimo intento. */
  motivo?: string;
};
