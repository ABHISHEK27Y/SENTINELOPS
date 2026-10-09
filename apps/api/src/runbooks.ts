import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkMarkdown, embedChunks, getEmbedder, InMemoryRetriever } from '@sentinelops/rag';

/** Resolve docs/runbooks relative to the repo root (or RUNBOOKS_DIR override). */
function runbooksDir(): string {
  if (process.env['RUNBOOKS_DIR']) return process.env['RUNBOOKS_DIR'];
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src → repo root is three levels up.
  return path.resolve(here, '../../../docs/runbooks');
}

/**
 * Builds the RAG index over the runbook corpus at startup. This is the retrieval
 * side of the RAG pipeline (chunk → embed → in-memory vector store); the pgvector
 * store is the persistent equivalent.
 */
export async function buildRunbookRetriever(): Promise<InMemoryRetriever> {
  const embedder = getEmbedder();
  const retriever = new InMemoryRetriever(embedder);
  const dir = runbooksDir();
  if (!existsSync(dir)) return retriever;

  const raw: Array<{ id: string; content: string; metadata: Record<string, unknown> }> = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const md = readFileSync(path.join(dir, file), 'utf8');
    const title = file.replace(/\.md$/, '').replace(/-/g, ' ');
    for (const chunk of chunkMarkdown(md)) {
      raw.push({
        id: `${file}#${chunk.index}`,
        content: `${chunk.heading}\n${chunk.content}`,
        metadata: { file, title, heading: chunk.heading },
      });
    }
  }
  retriever.add(await embedChunks(embedder, raw));
  return retriever;
}
