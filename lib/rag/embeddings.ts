import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { prisma } from '../prisma';

const PYTHON = process.env.PYTHON_BIN || 'python3';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const script = `
import sys, json
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
emb = model.encode(sys.argv[1]).tolist()
print(json.dumps(emb))
`;
    const tmpScript = '/tmp/embed_once.py';
    fs.writeFileSync(tmpScript, script);
    const proc = spawn(PYTHON, [tmpScript, text], { env: { ...process.env, TRANSFORMERS_OFFLINE: '0' } });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(out.trim())); } catch { reject(new Error('embed parse fail')); }
      } else {
        reject(new Error(`embed exit ${code}`));
      }
    });
  });
}

export async function searchKnowledge(
  query: string,
  agentSlug?: string,
  topK = 3
): Promise<{ title: string; content: string; similarity: number }[]> {
  const [queryEmb, knowledgeItems] = await Promise.all([
    generateEmbedding(query),
    prisma.knowledge.findMany({
      where: agentSlug ? { OR: [{ agentSlug }, { agentSlug: null }] } : { agentSlug: null },
      select: { id: true, title: true, content: true, embedding: true },
    }),
  ]);

  const scored = knowledgeItems
    .filter((k) => k.embedding)
    .map((k) => {
      const emb: number[] = JSON.parse(k.embedding!);
      return { title: k.title, content: k.content, id: k.id, similarity: cosineSimilarity(queryEmb, emb) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .filter((k) => k.similarity > 0.3);

  // update useCount in background
  scored.forEach((k) => {
    prisma.knowledge.update({ where: { id: k.id }, data: { useCount: { increment: 1 } } }).catch(() => {});
  });

  return scored.map(({ title, content, similarity }) => ({ title, content, similarity }));
}

export async function searchMemory(
  agentSlug: string,
  userId: string,
  query: string,
  topK = 3
): Promise<string[]> {
  const memories = await prisma.agentMemory.findMany({
    where: { agentSlug, userId },
    orderBy: [{ importance: 'desc' }, { lastAccess: 'desc' }],
    take: 20,
    select: { id: true, content: true, importance: true },
  });

  if (memories.length === 0) return [];

  const [queryEmb, memEmbs] = await Promise.all([
    generateEmbedding(query),
    Promise.all(memories.map((m) => generateEmbedding(m.content))),
  ]);

  const scored = memories
    .map((m, i) => ({ id: m.id, content: m.content, similarity: cosineSimilarity(queryEmb, memEmbs[i]) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  scored.forEach((m) => {
    prisma.agentMemory
      .update({ where: { id: m.id }, data: { accessCount: { increment: 1 }, lastAccess: new Date() } })
      .catch(() => {});
  });

  return scored.map((m) => m.content);
}

export async function saveMemory(
  agentSlug: string,
  userId: string,
  content: string,
  memoryType: 'conversation' | 'fact' | 'preference' = 'conversation',
  importance = 0.5
): Promise<void> {
  await prisma.agentMemory.create({
    data: { agentSlug, userId, content, memoryType, importance },
  });
}
