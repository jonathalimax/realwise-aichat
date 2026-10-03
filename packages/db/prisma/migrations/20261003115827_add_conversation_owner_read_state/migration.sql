-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastOwnerReplyAt" TIMESTAMP(3),
ADD COLUMN     "lastReadByOwnerAt" TIMESTAMP(3);
