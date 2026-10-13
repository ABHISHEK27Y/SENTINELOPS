-- IVFFlat trained on an empty table can miss matches in the tiny runbook corpus.
-- HNSW does not require a representative training set.
DROP INDEX IF EXISTS idx_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops);
