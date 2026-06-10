'use client';

import { useEffect } from 'react';

/**
 * 좀비 서비스워커 정리기.
 *
 * 과거 localhost:3000 에서 돌던 다른 앱이 등록한 서비스워커(sw.js)가 브라우저에 남아
 * fetch 를 가로채며 잘못된 response.clone() 으로 "body is already used" 에러를 유발한다.
 * 이 앱은 SW 를 쓰지 않으므로, 진입 시 등록된 SW 를 모두 해제하고 캐시를 비운다.
 * 실제로 해제한 경우에만 1회 새로고침해 SW 제어를 깔끔히 떨군다(루프 방지 플래그).
 */
export default function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .getRegistrations()
      .then(async (regs) => {
        if (regs.length === 0) return;
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));

        if (typeof caches !== 'undefined') {
          const keys = await caches.keys().catch(() => [] as string[]);
          await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
        }

        // 현재 페이지는 아직 좀비 SW 제어 하에 있으므로 1회만 새로고침해 떨군다.
        if (!sessionStorage.getItem('__sw_nuked')) {
          sessionStorage.setItem('__sw_nuked', '1');
          console.info('[sw-cleanup] 좀비 서비스워커 해제 완료 → 새로고침합니다.');
          location.reload();
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
