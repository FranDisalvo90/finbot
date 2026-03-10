import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { categories } from "./schema.js";

const CATEGORY_TREE = [
  {
    name: "VIVIENDA",
    emoji: "🏠",
    children: [
      "Alquiler",
      "Agua",
      "Luz",
      "Gas",
      "Expensas",
      "Internet",
      "Equipamiento",
    ],
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
    children: [
      "Seguro",
      "Estacionamiento",
      "Patente",
      "Nafta",
      "Peaje/lavado/service/arreglos",
    ],
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

async function seed() {
  console.log("Seeding categories...");

  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    const parent = CATEGORY_TREE[i];

    // Check if parent already exists
    const existing = await db
      .select()
      .from(categories)
      .where(eq(categories.name, parent.name));

    if (existing.length > 0) {
      console.log(`${parent.name} already exists, skipping.`);
      continue;
    }

    const [inserted] = await db
      .insert(categories)
      .values({
        name: parent.name,
        emoji: parent.emoji,
        sortOrder: i,
      })
      .returning();

    for (let j = 0; j < parent.children.length; j++) {
      await db.insert(categories).values({
        name: parent.children[j],
        parentId: inserted.id,
        sortOrder: j,
      });
    }

    console.log(`Seeded ${parent.name} with ${parent.children.length} children.`);
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
