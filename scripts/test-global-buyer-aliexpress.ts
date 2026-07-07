import { createServer, type Server } from 'http';
import { prepareGlobalPurchase } from '../lib/agents/tools/global-buyer';

function startMockAliExpressServer(): Promise<{ server: Server; url: string }> {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AliExpress Mock Product</title>
    <style>
      body { font-family: sans-serif; padding: 32px; }
      button { border: 0; border-radius: 8px; padding: 14px 18px; margin-right: 8px; cursor: pointer; }
      [data-pl="addtocart"] { background: #ff6a00; color: white; }
      [data-pl="buynow"] { background: #111827; color: white; }
    </style>
  </head>
  <body>
    <h1 data-pl="product-title">AliExpress Mock USB-C Fast Charger</h1>
    <button data-pl="addtocart" onclick="addToCart()">Add to Cart</button>
    <button data-pl="buynow">Buy Now</button>
    <div id="result" aria-live="polite"></div>
    <script>
      function addToCart() {
        document.getElementById('result').innerHTML =
          '<p>Added to cart</p><button data-pl="checkout">Checkout</button>';
      }
    </script>
  </body>
</html>`;

  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Failed to start mock server');
      resolve({ server, url: `http://127.0.0.1:${address.port}/item/mock-aliexpress-product.html` });
    });
  });
}

async function main() {
  const urlArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
  const clickRealPage = process.argv.includes('--click');
  const useMock = !urlArg;
  const mock = useMock ? await startMockAliExpressServer() : null;
  const productUrl = urlArg || mock!.url;

  try {
    const result = await prepareGlobalPurchase({
      productUrl,
      platform: 'aliexpress',
      action: 'add_to_cart',
      dryRun: useMock ? false : !clickRealPage,
      sessionId: useMock ? 'mock-aliexpress-test' : 'aliexpress-live-test',
      headless: true,
    });

    console.log(JSON.stringify({
      test_mode: useMock ? 'mock_aliexpress_product' : 'real_aliexpress_url',
      note: useMock
        ? '로컬 mock 페이지에서 Add to Cart 클릭을 수행했습니다.'
        : '실제 URL은 기본 dryRun입니다. 실제 장바구니 클릭은 --click 옵션이 필요합니다.',
      result,
    }, null, 2));
  } finally {
    await new Promise<void>((resolve) => mock?.server.close(() => resolve()) ?? resolve());
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
