import { DataTypes } from "sequelize";
import type { Model } from "sequelize";
import { sequelize } from "../conexiones.ts";

/**
 * Una fila de la tabla `activos`, tal como la devuelve Sequelize.
 *
 * Ojo con los DECIMAL: mysql2 los devuelve como TEXTO ("0.50000000") para no
 * perder precision al pasarlos a number. El repositorio es quien los convierte
 * al tipo `Activo` del dominio.
 */
export type ActivoFila = {
  id: string;
  simbolo: string;
  nombre: string;
  cantidad: string;
  precioCompra: string;
  creadoEn: Date;
  actualizadoEn: Date;
};

export type ActivoInstancia = Model<ActivoFila, ActivoFila>;

/**
 * Modelo de la entidad Activo. Describe la tabla para las consultas, pero NO la
 * crea: el esquema solo cambia por migraciones (ver src/datos/migraciones/).
 *
 * Los atributos usan los nombres del dominio (precioCompra) y `field` los mapea
 * a las columnas fisicas en snake_case (precio_compra). Las fechas y el id los
 * pone el servicio, por eso no hay timestamps automaticos.
 */
export const ActivoModelo = sequelize.define<ActivoInstancia>(
  "Activo",
  {
    id: { type: DataTypes.UUID, primaryKey: true },
    simbolo: { type: DataTypes.STRING(10), allowNull: false },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    cantidad: { type: DataTypes.DECIMAL(24, 8), allowNull: false },
    precioCompra: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: "precio_compra" },
    creadoEn: { type: DataTypes.DATE(3), allowNull: false, field: "creado_en" },
    actualizadoEn: { type: DataTypes.DATE(3), allowNull: false, field: "actualizado_en" },
  },
  { tableName: "activos", timestamps: false },
);
