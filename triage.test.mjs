import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

async function withServer(fn) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postTriage(baseUrl, body) {
  return fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("корректный текст → 200 ready с темой и черновиком", async () => {
  await withServer(async (baseUrl) => {
    const reply = await postTriage(baseUrl, { text: "Где моя доставка?" });
    assert.equal(reply.status, 200);
    const data = await reply.json();
    assert.equal(data.status, "ready");
    assert.equal(data.topic, "delivery");
    assert.ok(typeof data.draft === "string" && data.draft.trim().length > 0);
  });
});

test("пустой ввод → 400 invalid_input", async () => {
  await withServer(async (baseUrl) => {
    for (const body of [
      { text: "" },
      { text: "   " },
      {},
      { text: 42 },
      "не json",
    ]) {
      const reply = await postTriage(baseUrl, body);
      assert.equal(reply.status, 400, `тело: ${JSON.stringify(body)}`);
      assert.deepEqual(await reply.json(), { status: "invalid_input" });
    }
  });
});

test("ошибка модели → 200 manual_review", async () => {
  await withServer(async (baseUrl) => {
    const reply = await postTriage(baseUrl, { text: "[error] заявка" });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
  });
});

test("таймаут модели → 200 manual_review, ответ быстрее зависания модели", async () => {
  await withServer(async (baseUrl) => {
    const started = Date.now();
    const reply = await postTriage(baseUrl, { text: "[timeout] заявка" });
    const elapsed = Date.now() - started;
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
    assert.ok(elapsed < 1200, `ответ пришёл за ${elapsed} мс — таймаут не сработал`);
  });
});

test("битый JSON от модели → 200 manual_review", async () => {
  await withServer(async (baseUrl) => {
    const reply = await postTriage(baseUrl, { text: "[bad-json] заявка" });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
  });
});

test("неподдерживаемая тема → 200 manual_review", async () => {
  await withServer(async (baseUrl) => {
    const reply = await postTriage(baseUrl, { text: "[bad-topic] заявка" });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
  });
});

test("пустой черновик от модели → 200 manual_review", async () => {
  await withServer(async (baseUrl) => {
    const reply = await postTriage(baseUrl, { text: "[empty-draft] заявка" });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { status: "manual_review", topic: null, draft: null });
  });
});
