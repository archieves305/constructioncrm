-- Crew contact for guest links: the foreman's name and language (additive).
ALTER TABLE "crews" ADD COLUMN "foreman_name" TEXT;
ALTER TABLE "crews" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
