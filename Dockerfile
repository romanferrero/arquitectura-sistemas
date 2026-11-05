# ---------- Etapa 1: build ----------
# Compila el TypeScript a JavaScript. Esta etapa si necesita las devDependencies.
FROM node:24-alpine AS build

WORKDIR /app

# Se copian primero los manifiestos: si no cambian las dependencias, Docker
# reutiliza la capa cacheada y no vuelve a instalar todo en cada build.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Etapa 2: ejecucion ----------
# Imagen final: solo lleva el JavaScript compilado y las dependencias de
# produccion. No incluye TypeScript, ni el codigo fuente, ni el .env.
FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
# La configuracion de PM2: con ella cada contenedor corre su proceso (o sus procesos) bajo pm2-runtime.
COPY ecosystem.config.cjs ./

EXPOSE 3000

# Usuario sin privilegios (viene incluido en la imagen oficial de Node). PM2 guarda su estado en ~/.pm2 (/home/node).
USER node

# IMPORTANTE: aca NO se usa --env-file.
# Dentro de un contenedor la configuracion se inyecta como variables de
# entorno al ejecutarlo (docker run --env-file .env ...), de modo que la
# imagen queda libre de configuracion y sirve para cualquier entorno.
# Por defecto la imagen corre la API en MODO CLUSTER (una instancia por nucleo) junto con el monitor de reinicios, bajo
# pm2-runtime: es la variante de PM2 pensada para contenedores (queda en primer plano, reenvia las senales y
# escribe los logs en stdout). El worker y los suscriptores usan esta misma imagen con otro "command" (docker-compose.yml).
CMD ["./node_modules/.bin/pm2-runtime", "ecosystem.config.cjs", "--only", "api,monitor-reinicios"]
