import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createDatabase } from "@realwise/database";

export type AppDatabase = ReturnType<typeof createDatabase>;

@Injectable()
export class DatabaseProvider {
  private readonly database: AppDatabase | null;

  constructor() {
    this.database = process.env.DATABASE_URL ? createDatabase(process.env.DATABASE_URL) : null;
  }

  optional(): AppDatabase | null {
    return this.database;
  }

  require(): AppDatabase {
    if (!this.database) {
      throw new ServiceUnavailableException({
        code: "DATABASE_NOT_CONFIGURED",
        message: "Banco de dados não configurado para esta operação.",
        supportCode: "RW-DB-001",
      });
    }
    return this.database;
  }
}
