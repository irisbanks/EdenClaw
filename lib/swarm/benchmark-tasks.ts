// P2 벤치마크 과제 세트 — 자기완결 TypeScript 코딩 과제 (외부 패키지 의존 없음, tsc strict 통과가 합격 기준).
// 난이도 순으로 배치해 Gemma 31B의 단독 해결 한계선을 가늠한다.
import type { BenchmarkTask } from './benchmark';

export const DEFAULT_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'add-fn',
    prompt: 'index.ts에 두 number를 더해 number를 반환하는 export function add(a: number, b: number) 를 작성하라. 외부 import 없이.',
  },
  {
    id: 'dedupe-generic',
    prompt: 'index.ts에 제네릭 함수 export function dedupe<T>(items: T[]): T[] 를 작성하라. 입력 배열의 순서를 유지하며 중복을 제거한다. 외부 import 없이, strict 타입으로.',
  },
  {
    id: 'woo-sum-totals',
    prompt:
      'index.ts에 WooCommerce 정산용 함수를 작성하라. interface WooOrder { id: number; total: string; status: "completed" | "pending" } 를 정의하고, export function sumCompletedTotals(orders: WooOrder[]): number 가 status가 "completed"인 주문의 total(문자열 금액)을 number로 합산해 반환한다. 외부 import 없이, strict 타입으로.',
  },
  {
    id: 'settlement-net',
    prompt:
      'index.ts에 정산 순지급액 계산기를 작성하라. export interface SettlementConfig { commissionRate: number; feeRate: number } 와 export function netPayout(gross: number, cfg: SettlementConfig): number 를 정의하고, 순지급 = gross - gross*commissionRate - gross*feeRate 를 반환한다. 음수 입력은 0으로 클램프한다. strict 타입, 외부 import 없이.',
  },
  {
    id: 'lru-cache',
    prompt:
      'index.ts에 제네릭 LRU 캐시 클래스 export class LruCache<K, V> 를 작성하라. 생성자는 capacity: number 를 받고, get(key: K): V | undefined, set(key: K, value: V): void 를 제공하며 용량 초과 시 가장 오래 사용되지 않은 항목을 제거한다. Map 기반, 외부 import 없이, strict 타입으로.',
  },
];
