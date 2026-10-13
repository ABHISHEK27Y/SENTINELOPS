import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEnv } from '@sentinelops/config';
import { chunkMarkdown, getEmbedder, PostgresRetriever } from '@sentinelops/rag';

/** Resolve docs/runbooks relative to the repo root (or RUNBOOKS_DIR override). */
function runbooksDir(): string {
  if (process.env['RUNBOOKS_DIR']) return process.env['RUNBOOKS_DIR'];
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src → repo root is three levels up.
  return path.resolve(here, '../../../docs/runbooks');
}

/**
 * Builds the RAG index over the runbook corpus at startup. This is the retrieval
 * side of the RAG pipeline (chunk → embed → transactional pgvector replacement).
 */
export async function buildRunbookRetriever(): Promise<PostgresRetriever> {
  const embedder = getEmbedder();
  const retriever = new PostgresRetriever(embedder, getEnv().EMBEDDINGS_PROVIDER);
  const dir = runbooksDir();
  if (!existsSync(dir)) return retriever;

  for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const md = readFileSync(path.join(dir, file), 'utf8');
    const title = file.replace(/\.md$/, '').replace(/-/g, ' ');
    await retriever.index(
      `${getEnv().EMBEDDINGS_PROVIDER}:${file}`,
      title,
      chunkMarkdown(md).map(chunk => ({
        content: `${chunk.heading}\n${chunk.content}`,
        metadata: { file, title, heading: chunk.heading },
      }))
    );
  }
  return retriever;
}
