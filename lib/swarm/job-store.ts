// 자율 루프 잡 큐 저장소 (60초 서버리스 한계 우회용)
// - 라우트는 잡을 enqueue 하고 즉시 jobId 반환 → 독립 워커 프로세스가 시간 제한 없이 처리
// - Redis 백엔드(프로세스 간 공유, 프로덕션) + 인메모리 폴백(단일 프로세스/테스트)
import crypto from 'node:crypto';
import { redis } from '@/lib/redis';
import type { GenFile, LoopEvent } from './autonomous-loop';
import type { OmxEvent } from './omx-loop';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobKind = 'loop' | 'omx';
/** 잡 이벤트는 멀티파일 루프(LoopEvent) 또는 OMX 단일파일 루프(OmxEvent) 중 하나. */
export type StoredEvent = LoopEvent | OmxEvent;

export interface SwarmJob {
  id: string;
  email: string;
  userId: string | null;
  prompt: string;
  maxAttempts: number;
  kind: JobKind;
  targetFile?: string;
  status: JobStatus;
  attempts: number;
  gasCharged: number;
  finalProvider?: string;
  error?: string;
  files: GenFile[];
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  seq: number;
  at: string;
  event: StoredEvent;
}

export interface CreateJobInput {
  email?: string;
  userId: string | null;
  prompt: string;
  maxAttempts: number;
  kind?: JobKind;
  targetFile?: string;
}

export interface JobStore {
  createJob(input: CreateJobInput): Promise<SwarmJob>;
  getJob(id: string): Promise<SwarmJob | null>;
  getEvents(id: string, sinceSeq?: number): Promise<JobEventRecord[]>;
  appendEvent(id: string, event: StoredEvent): Promise<void>;
  updateJob(id: string, patch: Partial<Omit<SwarmJob, 'id' | 'createdAt'>>): Promise<SwarmJob | null>;
  claimNextQueued(): Promise<SwarmJob | null>;
  listJobs(limit?: number): Promise<SwarmJob[]>;
}

function newId(): string {
  return `job_${crypto.randomBytes(9).toString('hex')}`;
}

function baseJob(input: CreateJobInput): SwarmJob {
  const now = new Date().toISOString();
  return {
    id: newId(),
    email: input.email ?? '',
    userId: input.userId,
    prompt: input.prompt,
    maxAttempts: input.maxAttempts,
    kind: input.kind ?? 'loop',
    targetFile: input.targetFile,
    status: 'queued',
    attempts: 0,
    gasCharged: 0,
    files: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ───────────────────────── 인메모리 (단일 프로세스 / 테스트) ─────────────────────────
export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, SwarmJob>();
  private events = new Map<string, JobEventRecord[]>();
  private queue: string[] = [];

  async createJob(input: CreateJobInput): Promise<SwarmJob> {
    const job = baseJob(input);
    this.jobs.set(job.id, job);
    this.events.set(job.id, []);
    this.queue.push(job.id);
    return { ...job };
  }

  async getJob(id: string): Promise<SwarmJob | null> {
    const j = this.jobs.get(id);
    return j ? { ...j } : null;
  }

  async getEvents(id: string, sinceSeq = 0): Promise<JobEventRecord[]> {
    const list = this.events.get(id) ?? [];
    return list.filter((e) => e.seq > sinceSeq).map((e) => ({ ...e }));
  }

  async appendEvent(id: string, event: StoredEvent): Promise<void> {
    const list = this.events.get(id) ?? [];
    list.push({ seq: list.length + 1, at: new Date().toISOString(), event });
    this.events.set(id, list);
  }

  async updateJob(id: string, patch: Partial<Omit<SwarmJob, 'id' | 'createdAt'>>): Promise<SwarmJob | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    const next = { ...j, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, next);
    return { ...next };
  }

  async claimNextQueued(): Promise<SwarmJob | null> {
    const id = this.queue.shift();
    if (!id) return null;
    return this.updateJob(id, { status: 'running' });
  }

  async listJobs(limit = 50): Promise<SwarmJob[]> {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((j) => ({ ...j }));
  }
}

// ───────────────────────── Redis (프로세스 간 공유 / 프로덕션) ─────────────────────────
const K_JOB = (id: string) => `swarm:job:${id}`;
const K_EVENTS = (id: string) => `swarm:job:${id}:events`;
const K_QUEUED = 'swarm:jobs:queued';
const K_INDEX = 'swarm:jobs:index';
const JOB_TTL_SEC = 60 * 60 * 24 * 3; // 3일 보관

export class RedisJobStore implements JobStore {
  async createJob(input: CreateJobInput): Promise<SwarmJob> {
    const job = baseJob(input);
    await redis.set(K_JOB(job.id), JSON.stringify(job), 'EX', JOB_TTL_SEC);
    await redis.lpush(K_QUEUED, job.id);
    await redis.lpush(K_INDEX, job.id);
    await redis.ltrim(K_INDEX, 0, 999);
    return job;
  }

  async getJob(id: string): Promise<SwarmJob | null> {
    const raw = await redis.get(K_JOB(id));
    return raw ? (JSON.parse(raw) as SwarmJob) : null;
  }

  async getEvents(id: string, sinceSeq = 0): Promise<JobEventRecord[]> {
    const raw = await redis.lrange(K_EVENTS(id), sinceSeq, -1);
    return raw.map((s) => JSON.parse(s) as JobEventRecord);
  }

  async appendEvent(id: string, event: StoredEvent): Promise<void> {
    const len = await redis.llen(K_EVENTS(id));
    const record: JobEventRecord = { seq: len + 1, at: new Date().toISOString(), event };
    await redis.rpush(K_EVENTS(id), JSON.stringify(record));
    await redis.expire(K_EVENTS(id), JOB_TTL_SEC);
  }

  async updateJob(id: string, patch: Partial<Omit<SwarmJob, 'id' | 'createdAt'>>): Promise<SwarmJob | null> {
    const current = await this.getJob(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await redis.set(K_JOB(id), JSON.stringify(next), 'EX', JOB_TTL_SEC);
    return next;
  }

  async claimNextQueued(): Promise<SwarmJob | null> {
    const id = await redis.rpop(K_QUEUED);
    if (!id) return null;
    return this.updateJob(id, { status: 'running' });
  }

  async listJobs(limit = 50): Promise<SwarmJob[]> {
    const ids = await redis.lrange(K_INDEX, 0, limit - 1);
    const jobs = await Promise.all(ids.map((id) => this.getJob(id)));
    return jobs.filter((j): j is SwarmJob => j !== null);
  }
}

let singleton: JobStore | null = null;
/** 환경에 맞는 잡 저장소. 프로세스 간 공유(독립 워커)에는 SWARM_JOB_STORE=redis 필요. */
export function getJobStore(): JobStore {
  if (singleton) return singleton;
  const mode = (process.env.SWARM_JOB_STORE || (process.env.REDIS_URL ? 'redis' : 'memory')).toLowerCase();
  singleton = mode === 'redis' ? new RedisJobStore() : new MemoryJobStore();
  return singleton;
}
