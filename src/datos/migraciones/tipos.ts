import type { QueryInterface } from "sequelize";

/**
 * Una migracion es un cambio de esquema con su marcha atras:
 *  - up:   aplica el cambio.
 *  - down: lo deshace.
 *
 * Reciben el QueryInterface de Sequelize (createTable, addConstraint, ...) y
 * NO deben importar los modelos: una migracion describe el esquema tal como era
 * en su momento, y el modelo cambia con el tiempo.
 */
export type Migracion = {
  /** Nombre unico y ordenable; es lo que se guarda en la tabla `migraciones`. */
  nombre: string;
  up: (consultas: QueryInterface) => Promise<void>;
  down: (consultas: QueryInterface) => Promise<void>;
};
