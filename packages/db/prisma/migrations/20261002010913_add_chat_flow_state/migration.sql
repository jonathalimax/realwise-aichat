-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "flowNodeId" TEXT,
ADD COLUMN     "flowParams" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "flowStack" TEXT[];
