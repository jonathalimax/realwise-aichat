-- AlterEnum (kept in its own migration: a new enum value cannot be used in the transaction that adds it)
ALTER TYPE "Niche" ADD VALUE IF NOT EXISTS 'farmacia';
