import { db } from "./client.js";
import { categories } from "./schema.js";

export const CATEGORY_TREE = [
  {
    name: "VIVIENDA",
    emoji: "🏠",
    children: ["Alquiler", "Agua", "Luz", "Gas", "Expensas", "Internet", "Equipamiento"],
  },
  {
    name: "SERVICIOS Y PRODUCTOS VARIOS",
    emoji: "🛒",
    children: [
      "Compras/super/carnicería",
      "Entrenamiento/gimnasio",
      "Celular",
      "Transporte",
      "Comidas",
      "Peluquería",
      "Tecnología",
      "Ropa",
      "Tintorería",
      "Banco/comisiones",
      "Impuestos",
    ],
  },
  {
    name: "SALUD",
    emoji: "💊",
    children: ["Obra social", "Médico", "Farmacia"],
  },
  {
    name: "ENTRETENIMIENTO",
    emoji: "🎬",
    children: [
      "Cerámica",
      "SaaS",
      "Salidas/juntadas",
      "Libros",
      "Cafecito",
      "Club",
      "Escapadas",
      "Regalos",
      "Otros",
    ],
  },
  {
    name: "AUTO",
    emoji: "🚗",
    children: ["Seguro", "Estacionamiento", "Patente", "Nafta", "Peaje/lavado/service/arreglos"],
  },
  {
    name: "AMORT, DEPR Y PREVISIONES",
    emoji: "📊",
    children: [
      "Previsión mensual viajes",
      "Depreciación mensual auto",
      "Amortización bienes",
      "Previsión mantenimiento auto",
      "Previsión mantenimiento hogar",
    ],
  },
  {
    name: "INGRESOS",
    emoji: "💰",
    children: ["Sueldo", "Créditos en cuenta", "Freelance", "Otros ingresos"],
  },
];

export async function seedCategoriesForHousehold(householdId: string) {
  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    const parent = CATEGORY_TREE[i];

    const [inserted] = await db
      .insert(categories)
      .values({
        householdId,
        name: parent.name,
        emoji: parent.emoji,
        sortOrder: i,
      })
      .returning();

    await db.insert(categories).values(
      parent.children.map((name, j) => ({
        householdId,
        name,
        parentId: inserted.id,
        sortOrder: j,
      })),
    );
  }
}

async function seed() {
  console.log("Seeding categories...");
  const householdId = process.argv[2];
  if (!householdId) {
    console.error("Usage: seed <householdId>");
    process.exit(1);
  }
  await seedCategoriesForHousehold(householdId);
  console.log("Seed complete.");
  process.exit(0);
}

// Only run when executed directly as a script (not when imported)
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/seed.ts") || process.argv[1].endsWith("/seed.js"));

if (isMainModule) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
