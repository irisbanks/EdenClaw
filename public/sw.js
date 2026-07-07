// EdenClaw self-destructing service worker (kill-switch)
// 이 앱은 Service Worker를 쓰지 않는다. 과거 배포/다른 앱이 이 origin에 등록해 둔
// "좀비 SW"가 fetch를 가로채 페이지 로딩을 막는 경우를 위해, 이 스크립트는
// 자기 자신을 즉시 해제하고 모든 캐시를 비운 뒤 열린 탭을 1회 새로고침한다.
// (브라우저의 SW 업데이트 요청은 기존 SW를 우회하므로 좀비 SW가 있어도 이 파일을 받아 자폭한다.)
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch {}
      }
    })()
  );
});

// 혹시 남아 동작하더라도 절대 캐시하지 않고 항상 네트워크로 통과.
self.addEventListener('fetch', () => {});
