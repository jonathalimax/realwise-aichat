-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('presencial', 'remoto', 'visita_local');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "appointmentType" "AppointmentType" NOT NULL DEFAULT 'presencial',
ADD COLUMN     "listingId" TEXT,
ADD COLUMN     "locationAddress" TEXT;

-- AlterTable
ALTER TABLE "BookingSlot" ADD COLUMN     "appointmentType" "AppointmentType" NOT NULL DEFAULT 'presencial',
ADD COLUMN     "exceptionDate" TIMESTAMP(3),
ADD COLUMN     "listingId" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "defaultSlotDurationMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateIndex
CREATE INDEX "Appointment_businessId_startsAt_idx" ON "Appointment"("businessId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingSlot_businessId_appointmentType_idx" ON "BookingSlot"("businessId", "appointmentType");

-- CreateIndex
CREATE INDEX "BookingSlot_businessId_listingId_idx" ON "BookingSlot"("businessId", "listingId");

-- AddForeignKey
ALTER TABLE "BookingSlot" ADD CONSTRAINT "BookingSlot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
