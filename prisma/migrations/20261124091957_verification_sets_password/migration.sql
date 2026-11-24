-- Review M1: the password is no longer chosen at registration. It is set when the mailbox owner verifies the email.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- The password of an unverified account may have been chosen by someone other than the mailbox owner, so it is
-- cleared. The accounts and their verification tokens are kept: an outstanding link now leads to setting a password.
UPDATE "User" SET "passwordHash" = NULL WHERE "emailVerifiedAt" IS NULL;

-- A verified account always has a password; an unverified account never has one.
-- Not modelled by Prisma (it does not represent CHECK constraints); added by hand to this migration.
ALTER TABLE "User" ADD CONSTRAINT "User_passwordHash_matches_verification"
  CHECK (("passwordHash" IS NULL) = ("emailVerifiedAt" IS NULL));
