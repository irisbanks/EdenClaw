import { mkdir } from 'fs/promises';
import path from 'path';
import type { Locator, Page } from 'playwright';
import type {
  GlobalPurchasePlatform,
  GlobalPurchasePreparation,
  GlobalPurchaseStatus,
} from '../types/trader';

export interface PrepareGlobalPurchaseParams {
  productUrl: string;
  platform?: GlobalPurchasePlatform;
  action?: 'add_to_cart' | 'buy_now';
  dryRun?: boolean;
  sessionId?: string;
  headless?: boolean;
  timeoutMs?: number;
}

interface PlatformSelectors {
  addToCart: string[];
  buyNow: string[];
  login: string[];
  blocked: string[];
  cartReady: string[];
  checkoutGuard: string[];
  title: string[];
}

const SELECTORS: Record<GlobalPurchasePlatform, PlatformSelectors> = {
  aliexpress: {
    addToCart: [
      '[data-pl="addtocart"]',
      'button:has-text("Add to Cart")',
      'button:has-text("Add to cart")',
      'button:has-text("장바구니")',
      'button[class*="add-to-cart"]',
      '[class*="add-to-cart"] button',
      '.addcart',
    ],
    buyNow: [
      '[data-pl="buynow"]',
      'button:has-text("Buy Now")',
      'button:has-text("Buy now")',
      'button:has-text("바로 구매")',
      'button[class*="buy-now"]',
      '[class*="buy-now"] button',
    ],
    login: [
      'input[name="fm-login-id"]',
      'input[name="loginId"]',
      'input[type="password"]',
      'text=/sign in/i',
      'text=/로그인/i',
    ],
    blocked: [
      'text=/captcha/i',
      'text=/security check/i',
      'text=/verify/i',
      'iframe[src*="captcha"]',
    ],
    cartReady: [
      'text=/added to cart/i',
      'text=/go to cart/i',
      'text=/view shopping cart/i',
      'text=/장바구니에/i',
      'text=/장바구니 보기/i',
      '[class*="cart"]',
    ],
    checkoutGuard: [
      'button:has-text("Checkout")',
      'button:has-text("Place Order")',
      'button:has-text("Pay Now")',
      'button:has-text("결제")',
      'button:has-text("주문")',
      '[data-pl="checkout"]',
    ],
    title: [
      'h1[data-pl="product-title"]',
      'h1',
      '[class*="title--wrap"] h1',
      '[class*="product-title"]',
    ],
  },
  amazon: {
    addToCart: [
      '#add-to-cart-button',
      'input[name="submit.add-to-cart"]',
      '#add-to-cart-button-ubb',
      'button:has-text("Add to Cart")',
      'button:has-text("장바구니에 추가")',
    ],
    buyNow: [
      '#buy-now-button',
      'input[name="submit.buy-now"]',
      'button:has-text("Buy Now")',
      'button:has-text("지금 구매")',
    ],
    login: [
      '#ap_email',
      'input[name="email"]',
      'input[name="password"]',
      'text=/sign in/i',
      'text=/로그인/i',
    ],
    blocked: [
      'form[action*="validateCaptcha"]',
      '#captchacharacters',
      'text=/robot check/i',
      'text=/captcha/i',
    ],
    cartReady: [
      '#nav-cart-count',
      '#attachDisplayAddBaseAlert',
      'text=/added to cart/i',
      'text=/장바구니에 추가/i',
    ],
    checkoutGuard: [
      '#attach-sidesheet-checkout-button input',
      '#proceed-to-checkout-action input',
      'input[name="proceedToRetailCheckout"]',
      'input[name="placeYourOrder1"]',
      'button:has-text("Place your order")',
      'button:has-text("주문하기")',
      'button:has-text("Pay now")',
    ],
    title: [
      '#productTitle',
      '#title',
      'h1',
    ],
  },
};

function detectPlatform(url: string, override?: GlobalPurchasePlatform): GlobalPurchasePlatform | 'unknown' {
  if (override) return override;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host.includes('aliexpress.')) return 'aliexpress';
  if (host.includes('amazon.')) return 'amazon';
  return 'unknown';
}

function safeSessionId(value: string | undefined): string {
  return String(value || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function emptyResult(params: {
  status: GlobalPurchaseStatus;
  platform: GlobalPurchasePlatform | 'unknown';
  productUrl: string;
  action: 'add_to_cart' | 'buy_now';
  dryRun: boolean;
  message: string;
  warnings?: string[];
  checkoutGuard?: string[];
}): GlobalPurchasePreparation {
  return {
    status: params.status,
    platform: params.platform,
    url: params.productUrl,
    action: params.action,
    dry_run: params.dryRun,
    checkout_guard_selectors: params.checkoutGuard || [],
    message: params.message,
    warnings: params.warnings || [],
  };
}

async function firstVisible(page: Page, selectors: string[]): Promise<{ selector: string; locator: Locator } | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (visible) return { selector, locator };
  }
  return null;
}

async function readProductTitle(page: Page, selectors: string[]): Promise<string | undefined> {
  for (const selector of selectors) {
    const text = await page.locator(selector).first().textContent().catch(() => null);
    const title = String(text || '').replace(/\s+/g, ' ').trim();
    if (title) return title.slice(0, 180);
  }
  const title = await page.title().catch(() => '');
  return title ? title.replace(/\s+/g, ' ').trim().slice(0, 180) : undefined;
}

async function currentStatus(
  page: Page,
  selectors: PlatformSelectors,
  fallback: GlobalPurchaseStatus,
  action: 'add_to_cart' | 'buy_now',
): Promise<GlobalPurchaseStatus> {
  if (await firstVisible(page, selectors.blocked)) return 'blocked';
  if (await firstVisible(page, selectors.login)) return 'login_required';
  if (action === 'add_to_cart' && await firstVisible(page, selectors.cartReady)) return 'cart_ready';
  if (await firstVisible(page, selectors.checkoutGuard)) return 'payment_guard';
  if (await firstVisible(page, selectors.cartReady)) return 'cart_ready';
  return fallback;
}

export async function prepareGlobalPurchase(params: PrepareGlobalPurchaseParams): Promise<GlobalPurchasePreparation> {
  const action = params.action || 'add_to_cart';
  const dryRun = params.dryRun ?? true;
  const platform = detectPlatform(params.productUrl, params.platform);

  if (platform === 'unknown') {
    return emptyResult({
      status: 'unsupported_platform',
      platform,
      productUrl: params.productUrl,
      action,
      dryRun,
      message: '지원하지 않는 글로벌 소싱 플랫폼입니다. AliExpress 또는 Amazon URL만 처리합니다.',
    });
  }

  const selectors = SELECTORS[platform];
  const sessionDir = path.join(
    process.cwd(),
    'data',
    'browser-sessions',
    platform,
    safeSessionId(params.sessionId),
  );
  const storageStatePath = path.join(sessionDir, 'storage-state.json');

  await mkdir(sessionDir, { recursive: true });

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: params.headless ?? true,
    viewport: { width: 1365, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Seoul',
    acceptDownloads: false,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(params.timeoutMs || 12000);
    await page.goto(params.productUrl, { waitUntil: 'domcontentloaded', timeout: params.timeoutMs || 25000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    const productTitle = await readProductTitle(page, selectors.title);
    const blocked = await firstVisible(page, selectors.blocked);
    if (blocked) {
      await context.storageState({ path: storageStatePath });
      return {
        ...emptyResult({
          status: 'blocked',
          platform,
          productUrl: params.productUrl,
          action,
          dryRun,
          message: '플랫폼 보안 확인 또는 CAPTCHA가 감지되어 자동 구매 준비를 중단했습니다.',
          checkoutGuard: selectors.checkoutGuard,
          warnings: [`Blocked selector: ${blocked.selector}`],
        }),
        product_title: productTitle,
        session_dir: sessionDir,
        storage_state_path: storageStatePath,
      };
    }

    const targetSelectors = action === 'buy_now'
      ? [...selectors.buyNow, ...selectors.addToCart]
      : selectors.addToCart;
    const target = await firstVisible(page, targetSelectors);

    if (!target) {
      const status = await currentStatus(page, selectors, 'error', action);
      await context.storageState({ path: storageStatePath });
      return {
        ...emptyResult({
          status,
          platform,
          productUrl: params.productUrl,
          action,
          dryRun,
          message: '구매 준비 버튼을 찾지 못했습니다. 옵션 선택, 품절, 로그인, 또는 페이지 구조 변경 가능성이 있습니다.',
          checkoutGuard: selectors.checkoutGuard,
          warnings: ['Add to Cart/Buy Now selector not found'],
        }),
        product_title: productTitle,
        session_dir: sessionDir,
        storage_state_path: storageStatePath,
      };
    }

    if (dryRun) {
      await context.storageState({ path: storageStatePath });
      return {
        status: 'selector_ready',
        platform,
        url: params.productUrl,
        action,
        dry_run: true,
        product_title: productTitle,
        selector_used: target.selector,
        checkout_guard_selectors: selectors.checkoutGuard,
        session_dir: sessionDir,
        storage_state_path: storageStatePath,
        message: '구매 버튼 탐지 완료. dryRun=true라 장바구니 클릭은 수행하지 않았습니다.',
        warnings: [],
      };
    }

    await target.locator.click({ timeout: params.timeoutMs || 12000 });
    await page.waitForTimeout(1200);

    const status = await currentStatus(page, selectors, action === 'add_to_cart' ? 'cart_ready' : 'payment_guard', action);
    await context.storageState({ path: storageStatePath });

    return {
      status,
      platform,
      url: params.productUrl,
      action,
      dry_run: false,
      product_title: productTitle,
      selector_used: target.selector,
      checkout_guard_selectors: selectors.checkoutGuard,
      session_dir: sessionDir,
      storage_state_path: storageStatePath,
      message: status === 'payment_guard'
        ? '결제 직전 단계가 감지되어 자동화를 중단했습니다. 결제 버튼은 누르지 않았습니다.'
        : '장바구니 담기 또는 구매 준비 단계까지 완료했습니다. 결제 버튼은 누르지 않았습니다.',
      warnings: status === 'login_required' ? ['로그인이 필요합니다. 저장된 브라우저 세션으로 다시 시도하세요.'] : [],
    };
  } catch (error) {
    return {
      ...emptyResult({
        status: 'error',
        platform,
        productUrl: params.productUrl,
        action,
        dryRun,
        message: '글로벌 구매 준비 중 오류가 발생했습니다.',
        checkoutGuard: selectors.checkoutGuard,
        warnings: [error instanceof Error ? error.message : String(error)],
      }),
      session_dir: sessionDir,
      storage_state_path: storageStatePath,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
