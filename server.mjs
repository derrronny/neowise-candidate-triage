import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function isValidInput(text) {
  return typeof text === "string" && text.trim().length > 0;
}

function parseModelOutput(raw) {
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!result || typeof result !== "object") return null;
  if (!ALLOWED_TOPICS.has(result.topic)) return null;
  if (typeof result.draft !== "string" || result.draft.trim().length === 0) return null;
  return { topic: result.topic, draft: result.draft };
}

async function triage(text) {
  try {
    const raw = await classify(text, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    return parseModelOutput(raw);
  } catch {
    return null;
  }
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }

    let body;
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      return json(response, 400, { status: "invalid_input" });
    }
    if (!body || typeof body !== "object" || !isValidInput(body.text)) {
      return json(response, 400, { status: "invalid_input" });
    }

    const result = await triage(body.text);
    if (result === null) {
      return json(response, 200, { status: "manual_review", topic: null, draft: null });
    }
    return json(response, 200, { status: "ready", ...result });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
