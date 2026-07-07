import { NextRequest, NextResponse } from 'next/server';

// Next.js 16: `middleware` 컨벤션 → `proxy`로 마이그레이션
export function proxy(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
