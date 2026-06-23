import type { PrismaClient } from "../src/generated/prisma/client";
import { TEMPLATE_DEFS } from "../src/lib/estimates/template-defs";

// Idempotent: upsert each template by its stable `key`, then rebuild its
// sections/items from the static defs (delete-and-recreate cascades the items).
// Never touches user-created Estimate instances.
export async function seedEstimateTemplates(prisma: PrismaClient) {
  for (let t = 0; t < TEMPLATE_DEFS.length; t++) {
    const def = TEMPLATE_DEFS[t];

    const template = await prisma.estimateTemplate.upsert({
      where: { key: def.key },
      update: { category: def.category, name: def.name, sortOrder: t, isActive: true },
      create: { key: def.key, category: def.category, name: def.name, sortOrder: t },
    });

    // Rebuild scaffolding deterministically.
    await prisma.estimateTemplateSection.deleteMany({
      where: { templateId: template.id },
    });

    for (let s = 0; s < def.sections.length; s++) {
      const section = def.sections[s];
      await prisma.estimateTemplateSection.create({
        data: {
          templateId: template.id,
          title: section.title,
          sortOrder: s,
          items: {
            create: section.items.map((item, i) => ({
              description: item.description,
              unitType: item.unitType,
              defaultQuantity: item.defaultQuantity ?? null,
              defaultUnitPrice: item.defaultUnitPrice ?? null,
              defaultNotes: item.defaultNotes ?? null,
              isOptional: item.isOptional ?? false,
              sortOrder: i,
            })),
          },
        },
      });
    }
  }

  console.log(`  ${TEMPLATE_DEFS.length} estimate templates seeded`);
}
