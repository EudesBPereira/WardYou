import { PrismaClient } from "@prisma/client";

// Single Prisma client for the process. The schema was introspected from the
// live Azure Postgres (`prisma db pull`) — table names are snake_case, column
// names are PascalCase (legacy EF Core naming). Do not edit the DB schema here.
export const prisma = new PrismaClient();
