-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
