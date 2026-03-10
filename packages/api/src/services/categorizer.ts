import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { categorizationRules, categories, expenses } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";

interface CategorizeResult {
  expenseId: string;
  categoryId: string;
  confidence: number;
}

// Step 1: Match against existing rules
export async function applyRules(
  expenseList: { id: string; description: string }[]
): Promise<Map<string, string>> {
  const rules = await db.select().from(categorizationRules);
  const matched = new Map<string, string>();

  for (const expense of expenseList) {
    const desc = expense.description.toLowerCase();
    for (const rule of rules) {
      if (desc.includes(rule.pattern.toLowerCase())) {
        matched.set(expense.id, rule.categoryId);
        break;
      }
    }
  }

  return matched;
}

const BATCH_SIZE = 40;

// Step 2: AI categorization for unmatched expenses
export async function categorizeBatch(
  uncategorized: { id: string; description: string; amount: number }[]
): Promise<CategorizeResult[]> {
  if (uncategorized.length === 0) {
    console.log("[categorizer] skipping: no expenses");
    return [];
  }

  console.log("[categorizer] ANTHROPIC_API_KEY loaded:", env.ANTHROPIC_API_KEY ? "yes" : "no");

  if (!env.ANTHROPIC_API_KEY) {
    console.log("[categorizer] skipping: no ANTHROPIC_API_KEY");
    return [];
  }

  const allCategories = await db.select().from(categories);
  const parents = allCategories.filter((c) => !c.parentId && c.name !== "INGRESOS");
  const categoryList = parents
    .map((p) => {
      const children = allCategories
        .filter((c) => c.parentId === p.id)
        .map((c) => c.name);
      return `${p.emoji} ${p.name}: ${children.join(", ")}`;
    })
    .join("\n");

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const allResults: CategorizeResult[] = [];

  for (let i = 0; i < uncategorized.length; i += BATCH_SIZE) {
    const batch = uncategorized.slice(i, i + BATCH_SIZE);
    console.log(`[categorizer] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} expenses`);

    const expenseLines = batch
      .map((e) => `- [${e.id}] "${e.description}" ($${e.amount})`)
      .join("\n");

    const prompt = `You are a personal finance categorizer for an Argentine user. Given these categories:

${categoryList}

Categorize these expenses. Return a JSON array with objects: { "id": "expense-id", "categoryName": "exact child category name from the list", "confidence": 0.0-1.0 }

Rules:
- Only use category names that exist exactly in the list above (use child names, not parent names)
- Be conservative with confidence scores
- Every expense must appear in the result

Expenses:
${expenseLines}

Return ONLY the JSON array, no markdown, no backticks, no other text.`;

    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const text =
        message.content[0].type === "text" ? message.content[0].text : "";

      console.log("[categorizer] raw response:", text.substring(0, 200));

      let jsonStr = text.trim();
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      let parsed: { id: string; categoryName: string; confidence: number }[];
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("[categorizer] JSON parse failed:", e);
        continue;
      }

      console.log(`[categorizer] parsed ${parsed.length} results`);

      for (const item of parsed) {
        if (item.confidence < 0.6) {
          console.log(`[categorizer] low confidence (${item.confidence}): "${item.categoryName}"`);
          continue;
        }

        const cat = allCategories.find(
          (c) => c.name.toLowerCase() === item.categoryName.toLowerCase()
        );
        if (cat) {
          allResults.push({
            expenseId: item.id,
            categoryId: cat.id,
            confidence: item.confidence,
          });
        } else {
          console.log(`[categorizer] category not found: "${item.categoryName}"`);
        }
      }
    } catch (e) {
      console.error("[categorizer] API error:", e);
    }
  }

  console.log(`[categorizer] total matched: ${allResults.length}/${uncategorized.length}`);
  return allResults;
}

// Apply categorization results to DB
export async function applyCategorization(
  results: Map<string, string>
): Promise<number> {
  let count = 0;
  for (const [expenseId, categoryId] of results) {
    await db
      .update(expenses)
      .set({ categoryId })
      .where(eq(expenses.id, expenseId));
    count++;
  }
  return count;
}
