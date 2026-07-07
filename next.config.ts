import type { NextConfig } from "next";

const CORS_HEADERS = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization,X-Requested-With,X-Mobile-Client' },
  { key: 'Access-Control-Max-Age', value: '86400' },
];

const nextConfig: NextConfig = {
  // 빌드 산출물 디렉터리. 기본 .next, 필요 시 NEXT_DIST_DIR로 분리(권한 충돌 회피용).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['tbnmj-59-150-35-1.run.pinggy-free.link'],
  // 외부 접속 허용: 0.0.0.0 바인딩은 CLI 옵션으로 설정
  async headers() {
    return [
      // API 전체 CORS
      { source: '/api/:path*', headers: CORS_HEADERS },
      // 좀비 SW kill-switch: 항상 최신 sw.js를 받아 자폭하도록 캐시 금지
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      // SSE 스트림 캐시 방지
      {
        source: '/api/market/search/stream',
        headers: [
          ...CORS_HEADERS,
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
  // 외부 IP에서의 이미지 접근 허용
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '**' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default nextConfig;
