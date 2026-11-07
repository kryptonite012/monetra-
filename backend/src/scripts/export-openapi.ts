/* Writes the generated OpenAPI document to docs/openapi.json: npm run docs:openapi */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { buildOpenApiDocument } from '../docs/openapi';
import { closeDb } from '../db/knex';

createApp();
const doc = buildOpenApiDocument();
const target = path.resolve(__dirname, '../../../docs/openapi.json');
fs.writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${Object.keys(doc.paths).length} paths to ${target}`);
void closeDb();
