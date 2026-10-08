/**
 * Splits a markdown document into retrieval chunks. Chunks respect heading
 * boundaries and target a maximum size, keeping the nearest heading as context
 * so a retrieved chunk carries its section title.
 */
export interface Chunk {
  index: number;
  heading: string;
  content: string;
}

export interface ChunkOptions {
  /** Soft maximum characters per chunk. */
  maxChars?: number;
}

export function chunkMarkdown(md: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 600;
  const lines = md.split(/\r?\n/);

  const chunks: Chunk[] = [];
  let heading = '';
  let buf: string[] = [];
  let index = 0;

  const flush = () => {
    const content = buf.join('\n').trim();
    if (content.length > 0) {
      chunks.push({ index: index++, heading, content });
    }
    buf = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush(); // close the previous section
      heading = headingMatch[2]!.trim();
      continue;
    }
    buf.push(line);
    if (buf.join('\n').length >= maxChars && /^\s*$/.test(line)) {
      flush(); // break on a blank line once we're over the size target
    }
  }
  flush();

  return chunks;
}
