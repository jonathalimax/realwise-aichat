-- Handoff reason for non-clinical questions the AI could not answer (answered by an attendant). Additive only.

-- AlterEnum
ALTER TYPE "HandoffReason" ADD VALUE 'general_question';
