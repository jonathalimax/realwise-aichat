import { Module } from "@nestjs/common";
import { CatalogImportController, CatalogImportInternalController } from "./catalog-import.controller";
import { CATALOG_IMPORT_JOBS, CatalogImportService } from "./catalog-import.service";
import { BullCatalogImportJobs } from "./catalog-import.queue";
import { CATALOG_MODEL, GatewayCatalogModel } from "./catalog-model";

@Module({
  controllers: [CatalogImportController, CatalogImportInternalController],
  providers: [
    CatalogImportService,
    { provide: CATALOG_MODEL, useClass: GatewayCatalogModel },
    { provide: CATALOG_IMPORT_JOBS, useClass: BullCatalogImportJobs },
  ],
  exports: [CatalogImportService],
})
export class CatalogImportModule {}
