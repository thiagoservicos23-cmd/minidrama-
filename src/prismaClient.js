const { PrismaClient } = require("@prisma/client");

// Uma única instância do Prisma reaproveitada em toda a aplicação.
const prisma = new PrismaClient();

module.exports = prisma;
