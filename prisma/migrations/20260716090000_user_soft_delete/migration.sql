-- Borrado lógico de usuarios: "eliminar" marca deletedAt y anonimiza, sin
-- borrar la fila, para conservar su histórico (contenidos, ideas, versiones,
-- actividades y consumo IA).
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
