import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import fetch from "node-fetch";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static("public"));

const products = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "products.json"), "utf-8")
);

const faq = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "faq.json"), "utf-8")
);

const policies = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "policies.json"), "utf-8")
);

function normalize(text = "") {
  return text.toLowerCase().trim();
}

function includesAny(text, arr = []) {
  return arr.some((item) => text.includes(String(item).toLowerCase()));
}

function scoreProduct(message, product) {
  const text = normalize(message);
  let score = 0;

  if (product.name && text.includes(product.name.toLowerCase())) score += 10;
  if (product.category && text.includes(product.category.toLowerCase())) score += 5;

  if (product.subcategory && text.includes(product.subcategory.toLowerCase())) {
    score += 4;
  }

  if (product.skin_type?.some((s) => text.includes(s.toLowerCase()))) score += 6;
  if (product.concerns?.some((c) => text.includes(c.toLowerCase()))) score += 7;
  if (product.benefits?.some((b) => text.includes(b.toLowerCase()))) score += 5;

  return score;
}

function findTopProducts(message, limit = 3) {
  return products
    .map((product) => ({ product, score: scoreProduct(message, product) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}

function findFAQ(message) {
  const text = normalize(message);

  return faq.find(
    (item) =>
      text.includes(normalize(item.question)) ||
      includesAny(text, item.keywords || [])
  );
}

function findPolicy(message) {
  const text = normalize(message);

  for (const key of Object.keys(policies)) {
    const item = policies[key];
    if (includesAny(text, item.keywords || [])) {
      return item;
    }
  }

  return null;
}

function needsClarification(message) {
  const text = normalize(message);

  const vagueInputs = [
    "რამე მირჩიე",
    "პროდუქტი მინდა",
    "კრემი მინდა",
    "რა გაქვთ",
    "რა მირჩევ"
  ];

  return vagueInputs.includes(text);
}

app.post("/api/ask", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.json({ reply: "გთხოვ, დამისვი კითხვა." });
    }

    const policyMatch = findPolicy(message);
    if (policyMatch) {
      return res.json({ reply: policyMatch.answer });
    }

    const faqMatch = findFAQ(message);
    if (faqMatch) {
      return res.json({ reply: faqMatch.answer });
    }

    if (needsClarification(message)) {
      return res.json({
        reply:
          "მითხარი, რა ტიპის კანია ან რა პრობლემა გაწუხებს — მაგალითად აკნე, სიმშრალე, პიგმენტაცია."
      });
    }

    const matchedProducts = findTopProducts(message, 3);

   const context = matchedProducts
     .map(p => `
   სახელი: ${p.name || ""}
   კატეგორია: ${p.category || ""}
   ფასი: ${p.price || ""}
   `)
     .join("\n");


    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `
შენ ხარ Farmasi ასისტენტი.
პასუხობ ქართულად, მოკლედ და ბუნებრივად.
არ გამოიგონო ინფორმაცია.
თუ პროდუქტი გაქვს კონტექსტში — გამოიყენე მხოლოდ ის.
თუ საკმარისი ინფორმაცია არ არის, სთხოვე მომხმარებელს უფრო ზუსტად აღწეროს რა სჭირდება.
`
          },
          {
            role: "user",
            content: `
კითხვა: ${message}

პროდუქტები:
${context || "შესაბამისი პროდუქტები ვერ მოიძებნა."}
`
          }
        ]
      })
    });

    const rawText = await response.text();
    console.log("RAW პასუხი:", rawText);
    let data;

    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error("JSON შეცდომა:", rawText);
      return res.status(500).json({
        reply: "OpenAI პასუხი არასწორია"
      });
    }

    if (!response.ok) {
      console.error("OpenAI error:", data);
      return res.status(500).json({
        reply: "OpenAI შეცდომა დაფიქსირდა"
      });
    }

    const reply =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "ვერ ვუპასუხე";

    return res.json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      reply: "სერვერზე შეცდომა დაფიქსირდა"
    });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});