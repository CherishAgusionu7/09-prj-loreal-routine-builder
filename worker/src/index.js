const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_BODY_BYTES = 120_000;
const MAX_PRODUCTS = 20;
const MAX_HISTORY = 12;

const ALLOWED_EXACT_ORIGINS = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://gca-classroom.github.io",
]);

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.app\.github\.dev$/i,
  /^https:\/\/[a-z0-9-]+\.preview\.app\.github\.dev$/i,
];

function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }

  if (ALLOWED_EXACT_ORIGINS.has(origin)) {
    return true;
  }

  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function getCorsHeaders(origin) {
  if (!origin || !isAllowedOrigin(origin)) {
    return new Headers({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    });
  }

  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  });
}

function jsonResponse(payload, status = 200, origin = "") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...Object.fromEntries(getCorsHeaders(origin)),
    },
  });
}

function readBodyWithinLimit(request) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new Error("Request is too large.");
  }

  return request.text().then((text) => {
    if (text.length > MAX_BODY_BYTES) {
      throw new Error("Request is too large.");
    }

    return text;
  });
}

function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProducts(products) {
  if (!Array.isArray(products)) {
    throw new Error("selectedProducts must be an array.");
  }

  if (products.length === 0) {
    throw new Error("Select at least one product before generating a routine.");
  }

  if (products.length > MAX_PRODUCTS) {
    throw new Error("Too many products were submitted.");
  }

  return products.map((product, index) => {
    if (!product || typeof product !== "object") {
      throw new Error(`selectedProducts[${index}] must be an object.`);
    }

    const name = normalizeText(product.name);
    const brand = normalizeText(product.brand);
    const category = normalizeText(product.category);
    const description = normalizeText(product.description);
    const stableId = normalizeText(product.stableId || product.id);

    if (!name || !brand) {
      throw new Error(
        `selectedProducts[${index}] is missing a product name or brand.`,
      );
    }

    return {
      stableId,
      name,
      brand,
      category,
      description,
    };
  });
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.slice(-MAX_HISTORY).map((message, index) => {
    if (!message || typeof message !== "object") {
      throw new Error(`conversationHistory[${index}] must be an object.`);
    }

    const role = normalizeText(message.role);
    const content = normalizeText(message.content);

    if (!["user", "assistant"].includes(role)) {
      throw new Error(
        `conversationHistory[${index}] must have role user or assistant.`,
      );
    }

    if (!content) {
      throw new Error(
        `conversationHistory[${index}] must include text content.`,
      );
    }

    return { role, content };
  });
}

function buildSystemInstructions() {
  return [
    "You are a knowledgeable beauty routine advisor for skincare, haircare, makeup, and fragrance.",
    "Build routines primarily from the products the user provided.",
    "Do not pretend the user selected products that are not in the submitted JSON.",
    "Clearly separate morning, evening, weekly, makeup, haircare, or fragrance steps when relevant.",
    "Put products in a sensible order and explain how much to use and how often when safe to do so.",
    "Mention when a selected item does not logically fit the routine.",
    "Warn the user not to combine potentially irritating products without professional guidance.",
    "Recommend patch testing.",
    "Avoid diagnosing or treating medical conditions.",
    "Encourage a dermatologist or qualified professional for severe reactions, persistent irritation, or medical concerns.",
    "Be honest when the supplied product description does not provide enough information.",
    "Do not claim exact ingredients unless they appear in the supplied product data.",
    "Keep answers focused on beauty products and the generated routine.",
    "Politely redirect unrelated questions.",
    "For the first routine, use headings and numbered steps.",
    "Keep follow-up answers helpful and concise.",
    "Return readable Markdown.",
  ].join(" ");
}

function buildPrompt(action, selectedProducts, preferences, history, message) {
  const sections = [
    `Action: ${action}`,
    `Selected products:\n${JSON.stringify(selectedProducts, null, 2)}`,
    `Preferences:\n${JSON.stringify(preferences || {}, null, 2)}`,
    `Conversation history:\n${JSON.stringify(history || [], null, 2)}`,
  ];

  if (message) {
    sections.push(`New user message:\n${message}`);
  }

  if (action === "generateRoutine") {
    sections.push(
      "Create the first routine using the selected products and preferences. Include a title, short summary, morning steps when relevant, evening steps when relevant, product order, frequency guidance, cautions, and a patch-test reminder.",
    );
  } else {
    sections.push(
      "Answer the user's follow-up question while staying grounded in the selected products and previous conversation. Keep the reply concise unless a longer explanation is needed.",
    );
  }

  return sections.join("\n\n");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
      if (typeof block?.content === "string" && block.content.trim()) {
        return block.content.trim();
      }
    }
  }

  return "";
}

async function callOpenAI(
  env,
  prompt,
  selectedProducts,
  preferences,
  history,
  action,
) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("The Worker is missing the OPENAI_API_KEY secret.");
  }

  const model = env.OPENAI_MODEL || DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: buildSystemInstructions(),
      input: prompt,
      temperature: action === "generateRoutine" ? 0.7 : 0.5,
      max_output_tokens: 900,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      normalizeText(payload?.error?.message) || "The OpenAI request failed.";
    throw new Error(errorMessage);
  }

  const reply = extractResponseText(payload);
  if (!reply) {
    throw new Error("The model returned an empty response.");
  }

  return {
    reply,
    responseId: payload.id || "",
  };
}

function buildOkResponse(data, origin) {
  return jsonResponse(data, 200, origin);
}

function buildErrorResponse(message, status, origin) {
  return jsonResponse({ error: message }, status, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(origin)) {
        return buildErrorResponse("Origin not allowed.", 403, "");
      }

      return new Response(null, {
        status: 204,
        headers: Object.fromEntries(getCorsHeaders(origin)),
      });
    }

    if (request.method !== "POST") {
      return buildErrorResponse("Method not allowed.", 405, origin);
    }

    if (origin && !isAllowedOrigin(origin)) {
      return buildErrorResponse("Origin not allowed.", 403, "");
    }

    try {
      const bodyText = await readBodyWithinLimit(request);
      const body = parseJsonBody(bodyText);
      const action = normalizeText(body.action);

      if (!["generateRoutine", "chat"].includes(action)) {
        return buildErrorResponse("Unsupported action.", 400, origin);
      }

      const selectedProducts = normalizeProducts(body.selectedProducts);
      const preferences =
        body.preferences && typeof body.preferences === "object"
          ? body.preferences
          : {};
      const history = normalizeHistory(body.conversationHistory);
      const message = normalizeText(body.message);

      if (action === "chat" && !message) {
        return buildErrorResponse(
          "Chat messages cannot be empty.",
          400,
          origin,
        );
      }

      const prompt = buildPrompt(
        action,
        selectedProducts,
        preferences,
        history,
        message,
      );
      const result = await callOpenAI(
        env,
        prompt,
        selectedProducts,
        preferences,
        history,
        action,
      );
      return buildOkResponse(result, origin);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";
      const status = message.includes("too large") ? 413 : 400;
      return buildErrorResponse(message, status, origin);
    }
  },
};
