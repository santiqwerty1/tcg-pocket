ALTER TYPE "collection_stock_source" ADD VALUE 'tracker';
ALTER TABLE "collection_imports" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'csv';
ALTER TABLE "collection_imports" ADD CONSTRAINT "collection_imports_source_check" CHECK (source IN ('csv', 'tracker'));
