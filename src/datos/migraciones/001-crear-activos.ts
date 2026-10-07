import { DataTypes } from "sequelize";
import type { Migracion } from "./tipos.ts";

/**
 * Crea la tabla `activos`.
 *
 * Las reglas del dominio quedan tambien en la base, no solo en el codigo: aunque
 * otra aplicacion escriba directo en la tabla, MySQL rechaza un simbolo repetido
 * o una cantidad que no sea positiva.
 *
 * Tipos: cantidad y precio son DECIMAL (nunca FLOAT) para no arrastrar errores
 * de redondeo con dinero. El id es el UUID que genera el servicio.
 */
export const migracion001: Migracion = {
  nombre: "001-crear-activos",

  async up(consultas) {
    await consultas.createTable(
      "activos",
      {
        id: { type: DataTypes.CHAR(36), allowNull: false, primaryKey: true },
        simbolo: { type: DataTypes.STRING(10), allowNull: false },
        nombre: { type: DataTypes.STRING(50), allowNull: false },
        cantidad: { type: DataTypes.DECIMAL(24, 8), allowNull: false },
        precio_compra: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
        creado_en: { type: DataTypes.DATE(3), allowNull: false },
        actualizado_en: { type: DataTypes.DATE(3), allowNull: false },
      },
      { engine: "InnoDB", charset: "utf8mb4", collate: "utf8mb4_0900_ai_ci" },
    );

    await consultas.addConstraint("activos", {
      type: "unique",
      fields: ["simbolo"],
      name: "uq_activos_simbolo",
    });

    // CHECK por SQL directo: es la forma explicita en MySQL 8.
    await consultas.sequelize.query(
      "ALTER TABLE activos ADD CONSTRAINT chk_activos_cantidad_positiva CHECK (cantidad > 0)",
    );
    await consultas.sequelize.query(
      "ALTER TABLE activos ADD CONSTRAINT chk_activos_precio_compra_positivo CHECK (precio_compra > 0)",
    );
  },

  async down(consultas) {
    // Borrar la tabla se lleva consigo sus constraints.
    await consultas.dropTable("activos");
  },
};
