import mongoose from "mongoose";
import { instancia } from "../config/env.ts";
import { registradorDe } from "../config/logger.ts";
import { sequelize } from "../datos/conexiones.ts";
import { redis } from "../datos/redis.ts";
import { crearServicioSalud } from "./crearServicioSalud.ts";

/** El health check de la aplicacion: la fabrica ya conectada a MySQL, MongoDB y Redis. */
export const salud = crearServicioSalud({
  comprobaciones: {
    mysql: () => sequelize.authenticate(),
    // `ping` va a la base de verdad: `readyState` solo dice lo que el driver cree.
    mongodb: async () => {
      if (mongoose.connection.readyState !== 1) throw new Error("MongoDB no está conectado");
      await mongoose.connection.db?.admin().ping();
    },
    redis: () => redis.ping(),
  },
  tiempoMaximoMs: 2_000,
  registrador: registradorDe("Salud"),
  instancia,
  pid: process.pid,
  uptimeSegundos: () => process.uptime(),
  reloj: () => performance.now(),
  ahora: () => new Date(),
});
