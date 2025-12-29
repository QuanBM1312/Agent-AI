-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_customer_id_idx" ON "public"."contacts"("customer_id");

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Migrate existing contact_person data to contacts table
INSERT INTO "public"."contacts" ("customer_id", "name", "phone", "is_primary")
SELECT 
    "id" as "customer_id",
    "contact_person" as "name",
    "phone",
    true as "is_primary"
FROM "public"."customers"
WHERE "contact_person" IS NOT NULL AND "contact_person" != '';
