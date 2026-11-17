import "server-only";
import { z } from "zod";
import { WEBHOOK_EVENTS } from "@pti/db";
import {
  apiClientCreate,
  apiClientList,
  apiDraftCreate,
  apiInvoiceCreate,
  apiInvoiceList,
  apiSend,
} from "./schemas";

const js = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" });

/** Query schemas become individual `in: query` parameters. */
function queryParams(s: z.ZodObject) {
  const schema = js(s) as { properties?: Record<string, object>; required?: string[] };
  return Object.entries(schema.properties ?? {}).map(([name, p]) => ({
    name,
    in: "query",
    required: schema.required?.includes(name) ?? false,
    schema: p,
  }));
}

const json = (ref: string) => ({ content: { "application/json": { schema: { $ref: ref } } } });
const errors = {
  "401": { description: "Missing or invalid API key", ...json("#/components/schemas/Problem") },
  "403": {
    description: "Plan or permission doesn't allow this",
    ...json("#/components/schemas/Problem"),
  },
  "404": { description: "Not found", ...json("#/components/schemas/Problem") },
  "409": {
    description: "Conflict (state or idempotency)",
    ...json("#/components/schemas/Problem"),
  },
  "422": { description: "Validation failed", ...json("#/components/schemas/Problem") },
  "429": { description: "Rate limited; see Retry-After", ...json("#/components/schemas/Problem") },
};
const idPath = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const idem = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description: "Retries with the same key replay the first response for 24 hours.",
  schema: { type: "string", minLength: 8, maxLength: 200 },
};
const body = (ref: string) => ({ required: true, ...json(ref) });

const cache = new Map<string, object>();

/** `origin` comes from the request, so one build serves every deployment. */
export function openApiDocument(origin: string): object {
  const hit = cache.get(origin);
  if (hit) return hit;
  const doc = {
    openapi: "3.1.0",
    info: {
      title: "PromptToInvoice API",
      version: "1.0.0",
      description:
        "Create, issue and send invoices programmatically. Money is an integer in minor units with an ISO 4217 currency; decimals (quantities, prices, rates) are strings. Errors follow RFC 9457 (application/problem+json).",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ apiKey: [] }],
    paths: {
      "/invoices": {
        get: {
          summary: "List invoices",
          parameters: queryParams(apiInvoiceList),
          responses: {
            "200": {
              description: "A page of invoices",
              ...json("#/components/schemas/InvoiceList"),
            },
            ...errors,
          },
        },
        post: {
          summary: "Create a draft invoice",
          parameters: [idem],
          requestBody: body("#/components/schemas/InvoiceCreate"),
          responses: {
            "201": { description: "The draft", ...json("#/components/schemas/Invoice") },
            ...errors,
          },
        },
      },
      "/invoices/{id}": {
        get: {
          summary: "Retrieve an invoice",
          parameters: [idPath],
          responses: {
            "200": { description: "The invoice", ...json("#/components/schemas/Invoice") },
            ...errors,
          },
        },
      },
      "/invoices/{id}/issue": {
        post: {
          summary: "Issue a draft (assigns the number; irreversible)",
          parameters: [idPath, idem],
          responses: {
            "200": { description: "The issued invoice", ...json("#/components/schemas/Invoice") },
            ...errors,
          },
        },
      },
      "/invoices/{id}/send": {
        post: {
          summary: "Email the invoice to the client",
          parameters: [idPath, idem],
          requestBody: { required: false, ...json("#/components/schemas/Send") },
          responses: { "202": { description: "Queued" }, ...errors },
        },
      },
      "/invoices/{id}/pdf": {
        get: {
          summary: "Download the PDF",
          parameters: [idPath],
          responses: {
            "200": {
              description: "PDF/A-3",
              content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
            },
            ...errors,
          },
        },
      },
      "/clients": {
        get: {
          summary: "List clients",
          parameters: queryParams(apiClientList),
          responses: { "200": { description: "A page of clients" }, ...errors },
        },
        post: {
          summary: "Create a client",
          parameters: [idem],
          requestBody: body("#/components/schemas/ClientCreate"),
          responses: { "201": { description: "The client" }, ...errors },
        },
      },
      "/clients/{id}": {
        get: {
          summary: "Retrieve a client",
          parameters: [idPath],
          responses: { "200": { description: "The client" }, ...errors },
        },
      },
      "/drafts": {
        post: {
          summary: "Draft an invoice from plain language (AI)",
          parameters: [idem],
          requestBody: body("#/components/schemas/DraftCreate"),
          responses: { "201": { description: "An editable draft" }, ...errors },
        },
      },
    },
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((e) => [
        e,
        {
          post: {
            summary: e,
            description:
              'Signed with `PTI-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Reject if t is older than 5 minutes. Retries with backoff for ~1 day.',
            requestBody: json("#/components/schemas/Event"),
            responses: { "2XX": { description: "Acknowledged" } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Settings → API & webhooks. Keys look like pti_live_…",
        },
      },
      schemas: {
        InvoiceCreate: js(apiInvoiceCreate),
        Send: js(apiSend),
        ClientCreate: js(apiClientCreate),
        DraftCreate: js(apiDraftCreate),
        Invoice: {
          type: "object",
          description: "See the API guide for every field.",
          properties: { object: { const: "invoice" }, id: { type: "string" } },
        },
        InvoiceList: {
          type: "object",
          properties: {
            object: { const: "list" },
            data: { type: "array", items: { $ref: "#/components/schemas/Invoice" } },
            next_cursor: { type: ["string", "null"] },
          },
        },
        Event: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { enum: [...WEBHOOK_EVENTS] },
            created: { type: "string", format: "date-time" },
            data: { type: "object" },
          },
        },
        Problem: {
          type: "object",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            errors: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  };
  if (cache.size < 8) cache.set(origin, doc);
  return doc;
}
