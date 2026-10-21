'use strict';
const test = require('node:test');
const assert = require('node:assert');
const O = require('../server/openapi');

const PETSTORE3 = {
  openapi: '3.0.3',
  info: { title: 'Pet store', version: '1.2' },
  servers: [{ url: 'https://{env}.pets.example/v1', variables: { env: { default: 'api' } } }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Pet: { type: 'object', properties: { id: { type: 'integer', readOnly: true }, name: { type: 'string', example: 'Rex' }, tag: { type: 'string' }, born: { type: 'string', format: 'date' } } },
    },
  },
  paths: {
    '/pets': {
      get: { tags: ['pets'], summary: 'List pets', parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer', example: 20 } }, { name: 'q', in: 'query', schema: { type: 'string' } }] },
      post: { tags: ['pets'], summary: 'Create a pet', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
    },
    '/pets/{petId}': {
      parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { tags: ['pets'], operationId: 'showPet', parameters: [{ name: 'X-Trace', in: 'header', schema: { type: 'string', example: 'abc' } }] },
      delete: { tags: ['pets'], summary: 'Delete a pet', security: [] },
    },
  },
};

test('OpenAPI 3: base URL with server variables, one request per operation, tags in front', () => {
  let n = 0;
  const c = O.fromOpenApi(PETSTORE3, { uid: () => `id${++n}` });
  assert.strictEqual(c.name, 'Pet store 1.2');
  assert.deepStrictEqual(c.vars.find(([k]) => k === 'base'), ['base', 'https://api.pets.example/v1']);
  assert.strictEqual(c.requests.length, 4);
  assert.deepStrictEqual(c.requests.map((r) => `${r.folder}/${r.method} ${r.name}`), ['pets/GET List pets', 'pets/POST Create a pet', 'pets/GET showPet', 'pets/DELETE Delete a pet'], 'tags become folders');
});

test('OpenAPI 3: required query params filled, path params become variables, headers kept', () => {
  const c = O.fromOpenApi(PETSTORE3);
  const list = c.requests[0];
  assert.strictEqual(list.url, '{{base}}/pets?limit=20');
  const show = c.requests[2];
  assert.strictEqual(show.url, '{{base}}/pets/{{petId}}');
  assert.ok(c.vars.some(([k]) => k === 'petId'));
  assert.ok(show.headers.some(([k, v]) => k === 'X-Trace' && v === 'abc'));
});

test('OpenAPI 3: $ref body built from the schema (read-only fields left out), bearer token as variable', () => {
  const c = O.fromOpenApi(PETSTORE3);
  const create = c.requests[1];
  assert.deepStrictEqual(JSON.parse(create.body), { name: 'Rex', tag: '', born: '2026-01-01' });
  assert.ok(create.headers.some(([k, v]) => k === 'Authorization' && v === 'Bearer {{token}}'));
  assert.ok(c.vars.some(([k]) => k === 'token'));
  // security: [] auf der Operation = ohne Anmeldung
  assert.ok(!c.requests[3].headers.some(([k]) => k === 'Authorization'));
});

test('Swagger 2: host/basePath, body parameter, API key in a header', () => {
  const doc = {
    swagger: '2.0', info: { title: 'Shop' }, host: 'shop.example', basePath: '/api', schemes: ['https'],
    securityDefinitions: { key: { type: 'apiKey', in: 'header', name: 'X-API-Key' } }, security: [{ key: [] }],
    definitions: { Order: { type: 'object', properties: { item: { type: 'string', example: 'coffee' }, qty: { type: 'integer' } } } },
    paths: { '/orders': { post: { summary: 'Order', parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Order' } }] } } },
  };
  const c = O.fromOpenApi(doc);
  assert.deepStrictEqual(c.vars.find(([k]) => k === 'base'), ['base', 'https://shop.example/api']);
  const r = c.requests[0];
  assert.deepStrictEqual(JSON.parse(r.body), { item: 'coffee', qty: 0 });
  assert.ok(r.headers.some(([k, v]) => k === 'X-API-Key' && v === '{{X-API-Key}}'));
});

test('relative server URL uses the address it was loaded from; YAML and errors', () => {
  const c = O.fromOpenApi({ openapi: '3.1.0', info: { title: 'Local' }, servers: [{ url: '/v2' }], paths: { '/ping': { get: {} } } }, { source: 'http://localhost:8080/docs/openapi.json' });
  assert.deepStrictEqual(c.vars[0], ['base', 'http://localhost:8080/v2']);
  assert.strictEqual(c.requests[0].name, 'GET /ping');
  assert.deepStrictEqual(O.parseDoc('{"openapi":"3.0.0"}'), { openapi: '3.0.0' });
  assert.throws(() => O.parseDoc('openapi: 3.0.0'), /YAML/);
  assert.deepStrictEqual(O.parseDoc('openapi: 3.0.0', () => ({ openapi: '3.0.0' })), { openapi: '3.0.0' });
  assert.throws(() => O.fromOpenApi({ hello: 1 }), /OpenAPI/);
  assert.throws(() => O.fromOpenApi({ openapi: '3.0.0', paths: {} }), /no operations/);
});
