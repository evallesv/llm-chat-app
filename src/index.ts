/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/unum/uform-gen2-qwen-500m";

// Default system prompt
const SYSTEM_PROMPT =
  `
You are an expert invoice data extraction tool. Analyze the provided invoice image and extract the following information in a structured JSON format.
The JSON object should strictly follow this structure:
{
  "vendorName": "string or null",
  "client": "string or null, the name of the client or customer purchasing goods/services",
  "address": "string or null, the client's address or delivery/service location mentioned in the invoice. This could be a full address or a general area/location of sale.",
  "credit": "boolean or null",
  "cash": "boolean or null",
  "invoiceDate": "string (YYYY-MM-DD if possible, otherwise as it appears) or null",
  "invoiceNumber": "string or null",
  "totalAmount": "number or null",
  "currency": "string (e.g., USD, EUR) or null",
  "lineItems": [
    {
      "description": "string",
      "quantity": "number or null",
      "unitPrice": "number or null",
      "lineTotal": "number or null"
    }
  ]
}

Important notes for 'credit' and 'cash' fields:
- If the invoice explicitly states 'Contado' (Cash), or terms implying immediate payment, set "cash": true and "credit": false.
- If the invoice explicitly states 'Crédito' (Credit), or payment terms that imply deferred payment (e.g., 'Net 30 días', 'A crédito'), set "credit": true and "cash": false.
- If neither 'Contado' nor 'Crédito' (or similar terms) are clearly indicated, or if the payment method is ambiguous, both "credit" and "cash" should be null.
- Do not assume; base these fields on explicit information present in the invoice.

If any other information is not clearly visible or available, use null for the respective field value. For lineItems, if none are discernible, provide an empty array [].
Ensure the output is ONLY the JSON object, without any surrounding text, explanations, or markdown fences.
`;

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API Routes
    if (url.pathname === "/api/chat") {
      // Handle POST requests for chat
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      // Method not allowed for other request types
      return new Response("Method not allowed", { status: 405 });
    }

    // Handle 404 for unmatched routes
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    let messages: ChatMessage[] = [];
    let imageBase64: string | null = null;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      // Parse multipart form
      const formData = await request.formData();
      const messagesBlob = formData.get("messages");
      if (messagesBlob) {
        const messagesText = await (messagesBlob as Blob).text();
        messages = JSON.parse(messagesText);
      }
      const imageFile = formData.get("image");
      if (imageFile) {
        const arrayBuffer = await (imageFile as Blob).arrayBuffer();
        imageBase64 = Buffer.from(arrayBuffer).toString("base64");
      }
    } else {
      // Parse JSON request body
      const body = (await request.json()) as { messages?: ChatMessage[] };
      messages = body.messages || [];
    }

    // Add system prompt if not present
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // If there's an image, add it as a user message
    if (imageBase64) {
      messages.push({
        role: "user",
        content: `Attached invoice image (base64): ${imageBase64}`,
      });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
        // Uncomment to use AI Gateway
        // gateway: {
        //   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
        //   skipCache: false,      // Set to true to bypass cache
        //   cacheTtl: 3600,        // Cache time-to-live in seconds
        // },
      },
    );

    // Return streaming response
    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
