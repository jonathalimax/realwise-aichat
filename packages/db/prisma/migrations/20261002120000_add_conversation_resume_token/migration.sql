-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "resumeToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_resumeToken_key" ON "Conversation"("resumeToken");
