import mongoose, { Schema } from "mongoose";
import type { Model } from "mongoose";
import { OPERACIONES_AUDITORIA } from "../../modelos/auditoria.ts";
import type { OperacionAuditoria } from "../../modelos/auditoria.ts";

/** El documento tal como se guarda en MongoDB. */
export type DocumentoAuditoria = {
  operacion: OperacionAuditoria;
  entidad: "Activo";
  entidadId: string;
  antes?: Record<string, unknown>;
  despues?: Record<string, unknown>;
  camposModificados?: string[];
  metadatos?: Record<string, unknown>;
  ocurridoEn: Date;
};

/**
 * Schema del historial. MongoDB no obliga a una estructura, pero Mongoose agrega
 * una validacion minima desde la aplicacion: la operacion es una de tres, y la
 * entidad, su id y la fecha son obligatorios.
 *
 * `antes`, `despues` y `metadatos` son `Mixed` a proposito: su contenido depende
 * de la operacion y no hace falta una tabla por cada forma. Es la razon por la que
 * esto vive en MongoDB y no en MySQL.
 */
const esquema = new Schema<DocumentoAuditoria>(
  {
    operacion: { type: String, enum: OPERACIONES_AUDITORIA, required: true },
    entidad: { type: String, enum: ["Activo"], required: true },
    entidadId: { type: String, required: true },
    antes: { type: Schema.Types.Mixed, required: false },
    despues: { type: Schema.Types.Mixed, required: false },
    camposModificados: { type: [String], required: false },
    metadatos: { type: Schema.Types.Mixed, required: false },
    ocurridoEn: { type: Date, default: Date.now, required: true },
  },
  { collection: "auditoria_activos", versionKey: false },
);

// Las tres consultas que tiene el historial, cada una con su indice:
//  - el historial de un activo, del evento mas reciente al mas viejo;
//  - todo el historial, del mas reciente al mas viejo;
//  - lo mismo, filtrado por operacion.
esquema.index({ entidadId: 1, ocurridoEn: -1 });
esquema.index({ ocurridoEn: -1 });
esquema.index({ operacion: 1, ocurridoEn: -1 });

export const RegistroAuditoriaModelo: Model<DocumentoAuditoria> =
  (mongoose.models["RegistroAuditoria"] as Model<DocumentoAuditoria> | undefined) ??
  mongoose.model<DocumentoAuditoria>("RegistroAuditoria", esquema);
