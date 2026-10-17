-- Businesses created by an admin (owner invited by email) have no phone until/unless one is added.
-- Additive/relaxing change: existing rows and the UNIQUE index are untouched (Postgres allows many NULLs).
ALTER TABLE "Business" ALTER COLUMN "phone" DROP NOT NULL;
