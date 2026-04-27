import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma = new PrismaClient({ adapter });

const categories = ['electronics', 'fashion', 'food', 'digital', 'general'] as const;
const regions = ['서울', '부산', '인천', '대구', '광주', '대전', '수원', '성남'];
const sellerIds = ['seller_001', 'seller_002', 'seller_003', 'seller_004', 'seller_005'];
const sellerNames = ['테크마트', '패션허브', '신선식탁', '디지털스토어', '만물상점'];

const productTemplates = [
  // electronics (10)
  { title: '삼성 갤럭시 버즈 프로 무선이어폰', desc: '탁월한 노이즈 캔슬링과 360도 오디오를 지원하는 프리미엄 무선 이어폰. IPX7 방수 등급으로 스포츠 활동에도 적합합니다.', price: 189000, cat: 'electronics', tags: ['이어폰', '무선', '삼성', '블루투스'] },
  { title: 'LG OLED 55인치 스마트TV', desc: '완벽한 블랙과 생생한 색상을 자랑하는 OLED 디스플레이. 넷플릭스, 유튜브 등 스트리밍 서비스 내장.', price: 1290000, cat: 'electronics', tags: ['TV', 'OLED', 'LG', '스마트TV'] },
  { title: '애플 에어팟 맥스 헤드폰', desc: '업계 최고 수준의 액티브 노이즈 캔슬링과 투명 모드. 최대 20시간 배터리 지속.', price: 769000, cat: 'electronics', tags: ['헤드폰', '애플', '노이즈캔슬링'] },
  { title: '소니 WH-1000XM5 무선헤드폰', desc: '소니의 플래그십 노이즈 캔슬링 헤드폰. 30시간 배터리와 멀티포인트 연결 지원.', price: 420000, cat: 'electronics', tags: ['헤드폰', '소니', '무선', '노이즈캔슬링'] },
  { title: '갤럭시 워치6 클래식 스마트워치', desc: '회전 베젤 디자인의 프리미엄 스마트워치. 혈압 측정, 심전도 기능 포함.', price: 489000, cat: 'electronics', tags: ['스마트워치', '갤럭시', '삼성', '헬스'] },
  { title: '키보드 기계식 게이밍 RGB', desc: 'Cherry MX 스위치 탑재 게이밍 키보드. 1600만 색상 RGB 백라이트와 매크로 키 지원.', price: 159000, cat: 'electronics', tags: ['키보드', '게이밍', '기계식', 'RGB'] },
  { title: '4K 웹캠 업무용 재택근무', desc: '4K 해상도의 업무용 웹캠. 자동 조명 보정과 AI 배경 블러 기능. 마이크 내장.', price: 89000, cat: 'electronics', tags: ['웹캠', '재택근무', '4K', '회의'] },
  { title: '65W GaN 고속충전기 멀티포트', desc: 'GaN 기술 적용 65W 고속충전기. USB-C 3포트, USB-A 1포트. 접이식 플러그.', price: 45000, cat: 'electronics', tags: ['충전기', 'GaN', '고속충전', 'USB-C'] },
  { title: '외장 SSD 1TB 포터블', desc: '1TB 용량의 포터블 외장 SSD. USB 3.2 Gen2 지원으로 최대 1,050MB/s 읽기 속도.', price: 129000, cat: 'electronics', tags: ['SSD', '외장하드', '포터블', '저장장치'] },
  { title: '27인치 QHD 모니터 165Hz', desc: '2560x1440 QHD 해상도, 165Hz 주사율의 게이밍 모니터. 1ms 응답속도, FreeSync 지원.', price: 399000, cat: 'electronics', tags: ['모니터', 'QHD', '게이밍', '165Hz'] },

  // fashion (10)
  { title: '프리미엄 울 코트 겨울용', desc: '100% 울 소재로 제작된 클래식 롱코트. 빈티지 버튼 디테일과 따뜻한 안감 처리.', price: 289000, cat: 'fashion', tags: ['코트', '울', '겨울', '클래식'] },
  { title: '나이키 에어맥스 270 운동화', desc: '270도 에어유닛을 탑재한 나이키 에어맥스. 일상 착용과 가벼운 운동에 최적화된 쿠셔닝.', price: 179000, cat: 'fashion', tags: ['운동화', '나이키', '에어맥스', '스니커즈'] },
  { title: '린넨 셔츠 여름 시원한', desc: '100% 린넨 소재의 여름 셔츠. 통기성이 뛰어나 더운 날씨에도 쾌적한 착용감.', price: 59000, cat: 'fashion', tags: ['셔츠', '린넨', '여름', '시원'] },
  { title: '데님 자켓 빈티지 워싱', desc: '빈티지 워싱 처리된 데님 자켓. 클래식한 디자인으로 다양한 스타일링에 활용 가능.', price: 89000, cat: 'fashion', tags: ['자켓', '데님', '빈티지', '캐주얼'] },
  { title: '슬랙스 남성 스트레이트핏', desc: '신축성 있는 소재로 편안한 착용감. 오피스와 캐주얼 스타일 모두 어울리는 디자인.', price: 79000, cat: 'fashion', tags: ['슬랙스', '바지', '남성', '오피스'] },
  { title: '가죽 크로스백 미니 여성', desc: '고급 PU 가죽 소재의 미니 크로스백. 수납공간이 충분하고 조절 가능한 긴 스트랩.', price: 69000, cat: 'fashion', tags: ['가방', '크로스백', '여성', '가죽'] },
  { title: '아디다스 울트라부스트 러닝화', desc: '에너지 리턴이 뛰어난 부스트 미드솔. 마라톤부터 일상 달리기까지 적합한 러닝화.', price: 219000, cat: 'fashion', tags: ['러닝화', '아디다스', '울트라부스트', '스포츠'] },
  { title: '오버사이즈 후드 집업 기모', desc: '기모 안감의 따뜻한 오버사이즈 집업 후드. 루즈한 실루엣으로 편안한 착용감.', price: 69000, cat: 'fashion', tags: ['후드', '집업', '오버사이즈', '겨울'] },
  { title: '골프 폴로 셔츠 드라이핏', desc: '드라이핏 소재의 골프 폴로 셔츠. 빠른 흡습과 건조로 쾌적한 라운딩 가능.', price: 89000, cat: 'fashion', tags: ['폴로', '골프', '드라이핏', '스포츠'] },
  { title: '캐시미어 니트 터틀넥', desc: '부드러운 캐시미어 소재의 터틀넥 니트. 보온성이 뛰어나고 피부에 자극이 적습니다.', price: 199000, cat: 'fashion', tags: ['니트', '캐시미어', '터틀넥', '겨울'] },

  // food (10)
  { title: '유기농 국내산 감자 5kg', desc: '강원도 고랭지에서 재배한 신선한 유기농 감자. 전분 함량이 높아 찜, 볶음에 최적.', price: 18900, cat: 'food', tags: ['감자', '유기농', '강원도', '국내산'] },
  { title: '제주 프리미엄 삼다수 2L x 24', desc: '제주 화산암반수에서 채취한 미네랄 풍부한 생수. 24개 묶음 대용량 패키지.', price: 29900, cat: 'food', tags: ['생수', '제주', '삼다수', '미네랄'] },
  { title: '국내산 한우 등심 1kg 냉장', desc: '1+ 등급 국내산 한우 등심. 마블링이 뛰어나고 육즙이 풍부한 프리미엄 소고기.', price: 89000, cat: 'food', tags: ['한우', '소고기', '등심', '냉장'] },
  { title: '청국장 분말 전통발효 500g', desc: '전통 방식으로 발효한 청국장 분말. 이소플라본과 낫토키나아제가 풍부한 건강식품.', price: 24900, cat: 'food', tags: ['청국장', '발효', '건강식품', '분말'] },
  { title: '유기농 아보카도 6개입', desc: '멕시코산 유기농 아보카도 6개 세트. 풍부한 불포화지방산과 비타민E 함유.', price: 19900, cat: 'food', tags: ['아보카도', '유기농', '과일', '건강'] },
  { title: '수입 블루베리 냉동 1kg', desc: '캐나다산 냉동 블루베리 1kg. 항산화 성분이 풍부하며 스무디, 베이킹에 활용.', price: 15900, cat: 'food', tags: ['블루베리', '냉동', '수입', '과일'] },
  { title: '천연 꿀 야생화 국내산 500g', desc: '국내 양봉농가에서 생산한 100% 천연 야생화 꿀. 항균, 항산화 효과 뛰어남.', price: 34900, cat: 'food', tags: ['꿀', '천연', '야생화', '국내산'] },
  { title: '녹차 말차 파우더 프리미엄 100g', desc: '일본 우지 산지의 프리미엄 말차 파우더. L-테아닌이 풍부해 집중력 향상에 도움.', price: 29900, cat: 'food', tags: ['말차', '녹차', '파우더', '일본'] },
  { title: '유기농 두부 단단한 400g x 3', desc: '콩 100% 국내산 유기농 두부. 단단한 식감으로 찌개, 구이에 적합.', price: 12900, cat: 'food', tags: ['두부', '유기농', '국내산', '건강'] },
  { title: '스페셜티 원두커피 에티오피아 250g', desc: '에티오피아 예르가체프 싱글오리진 원두. 플로럴, 시트러스 향의 라이트 로스팅.', price: 22900, cat: 'food', tags: ['커피', '원두', '에티오피아', '스페셜티'] },

  // digital (10)
  { title: '어도비 포토샵 연간 구독권', desc: '포토샵 CC 1년 구독 라이선스. 20GB 클라우드 스토리지 포함. 모든 기기에서 사용 가능.', price: 299000, cat: 'digital', tags: ['포토샵', '어도비', '구독', '디자인'] },
  { title: '마이크로소프트 오피스 365 1년', desc: 'Word, Excel, PowerPoint 포함 오피스 365 1년 라이선스. PC/Mac/모바일 지원.', price: 119000, cat: 'digital', tags: ['오피스', '마이크로소프트', '구독', '업무'] },
  { title: 'ChatGPT Plus 1개월 구독', desc: 'GPT-4 무제한 이용, DALL-E 이미지 생성, 플러그인 기능 포함 프리미엄 구독.', price: 27000, cat: 'digital', tags: ['ChatGPT', 'AI', '구독', 'GPT-4'] },
  { title: '넷플릭스 프리미엄 3개월 이용권', desc: '4K UHD + 4스크린 동시 시청 가능 넷플릭스 프리미엄 3개월 이용권.', price: 54000, cat: 'digital', tags: ['넷플릭스', '스트리밍', '구독', '영화'] },
  { title: '유데미 온라인 강의 3개월 구독', desc: '전 세계 213,000+ 강의 무제한 수강. 프로그래밍, 디자인, 마케팅 등 다양한 분야.', price: 39000, cat: 'digital', tags: ['유데미', '강의', '교육', '구독'] },
  { title: 'VPN 서비스 1년 이용권', desc: '60개국 6000+ 서버. AES-256 암호화. 무제한 대역폭과 최대 6기기 동시 접속.', price: 49000, cat: 'digital', tags: ['VPN', '보안', '개인정보', '구독'] },
  { title: '스팀 게임 크레딧 50,000원', desc: '스팀 플랫폼 게임 구매에 사용할 수 있는 50,000원 크레딧 코드.', price: 50000, cat: 'digital', tags: ['스팀', '게임', '크레딧', 'PC게임'] },
  { title: '인프런 개발 강의 패키지', desc: '파이썬, 자바스크립트, 리액트 3개 강의 패키지. 무기한 수강 가능.', price: 89000, cat: 'digital', tags: ['인프런', '개발', '강의', '프로그래밍'] },
  { title: 'Notion Pro 6개월 구독', desc: 'Notion 프로 플랜 6개월. 무제한 블록, 파일 업로드, 버전 히스토리 포함.', price: 54000, cat: 'digital', tags: ['Notion', '생산성', '구독', '업무'] },
  { title: '클로드 AI Pro 1개월 이용권', desc: 'Claude Opus 모델 무제한 이용 및 우선 접근. 고급 분석, 코딩, 창작 지원.', price: 27000, cat: 'digital', tags: ['클로드', 'AI', '구독', 'Anthropic'] },

  // general (10)
  { title: '에르고노믹 사무용 의자', desc: '허리 지지대와 팔걸이 높이 조절이 가능한 인체공학 의자. 메쉬 등판으로 통기성 우수.', price: 389000, cat: 'general', tags: ['의자', '사무용', '인체공학', '재택근무'] },
  { title: '식물성 스킨케어 세트 5종', desc: '천연 식물 성분으로 만든 스킨케어 5종 세트. 파라벤 프리, 알코올 프리.', price: 89000, cat: 'general', tags: ['스킨케어', '식물성', '천연', '화장품'] },
  { title: '필라테스 요가 매트 두꺼운', desc: '10mm 두께의 NBR 소재 요가 매트. 논슬립 처리와 운반 스트랩 포함.', price: 39000, cat: 'general', tags: ['요가', '매트', '필라테스', '운동'] },
  { title: '캠핑 텐트 4인용 방수', desc: '4인용 패밀리 텐트. 20,000mm 방수 코팅과 이중 레이어 구조로 비에도 안전.', price: 189000, cat: 'general', tags: ['텐트', '캠핑', '4인용', '방수'] },
  { title: '스탠리 진공 보온병 1L', desc: '18/8 스테인리스 진공 보온병. 최대 24시간 보온/보냉. 방수 뚜껑 포함.', price: 69000, cat: 'general', tags: ['보온병', '텀블러', '스탠리', '캠핑'] },
  { title: '도서 파이썬 알고리즘 인터뷰', desc: '95개 알고리즘 문제 풀이 수록. IT 기업 코딩 테스트 완벽 대비 파이썬 전문서.', price: 42000, cat: 'general', tags: ['도서', '파이썬', '알고리즘', '코딩'] },
  { title: '공기청정기 20평형 H13 헤파', desc: 'H13 헤파필터 탑재. 20평형 공간 커버. PM0.1 초미세먼지 99.97% 제거.', price: 289000, cat: 'general', tags: ['공기청정기', '헤파', '먼지', '실내'] },
  { title: '프리미엄 면 이불 세트 킹', desc: '100% 이집트 면 소재 킹사이즈 이불 세트. 이불, 베개 커버 포함. 사계절용.', price: 159000, cat: 'general', tags: ['이불', '침구', '킹사이즈', '면'] },
  { title: '전동 칫솔 소닉케어 프리미엄', desc: '음파 진동 전동 칫솔. 분당 31,000회 진동. 스마트 타이머와 압력 감지 기능.', price: 129000, cat: 'general', tags: ['칫솔', '전동', '음파', '구강케어'] },
  { title: '독서대 북스탠드 높이조절', desc: '알루미늄 합금 소재 독서대. 높이와 각도 조절 가능. 태블릿, 책 모두 사용 가능.', price: 35000, cat: 'general', tags: ['독서대', '북스탠드', '공부', '태블릿'] },
];

const reviewTemplates = [
  { rating: 5, comment: '정말 품질이 좋아요. 다음에도 구매하고 싶습니다!' },
  { rating: 5, comment: '배송이 빠르고 상품 상태가 완벽합니다.' },
  { rating: 4, comment: '가성비가 훌륭합니다. 추천합니다.' },
  { rating: 4, comment: '설명과 동일한 상품이 왔어요. 만족합니다.' },
  { rating: 3, comment: '보통 수준입니다. 가격 대비 나쁘지 않아요.' },
  { rating: 5, comment: '이 가격에 이 품질이면 최고네요!' },
  { rating: 4, comment: '포장도 꼼꼼하고 상품도 좋습니다.' },
  { rating: 2, comment: '기대보다 조금 아쉬웠습니다.' },
  { rating: 5, comment: '완전 만족! 재구매 의사 100%입니다.' },
  { rating: 3, comment: '무난합니다. 특별히 나쁜 점은 없어요.' },
];

const reviewerNames = ['김철수', '이영희', '박민수', '최지은', '정현우', '강다은', '윤서준', '임지수', '오태양', '한소라'];

async function main() {
  console.log('🌱 AI Market v2 시드 데이터 생성 시작...');

  // 기존 시드 데이터 확인
  const existingCount = await prisma.product.count();
  console.log(`현재 상품 수: ${existingCount}`);

  // 상품 50개 생성
  const createdProducts: { id: string; price: number; createdAt: Date }[] = [];

  for (let i = 0; i < productTemplates.length; i++) {
    const tmpl = productTemplates[i];
    const sellerIdx = i % sellerIds.length;
    const region = regions[i % regions.length];

    const basePrice = tmpl.price;
    const variation = (Math.random() - 0.5) * 0.1 * basePrice;
    const price = Math.round((basePrice + variation) / 100) * 100;

    const viewCount = Math.floor(Math.random() * 500) + 10;
    const buyCount = Math.floor(viewCount * (0.05 + Math.random() * 0.15));

    const product = await prisma.product.create({
      data: {
        title: tmpl.title,
        description: tmpl.desc,
        price,
        currency: 'ET',
        category: tmpl.cat,
        tags: JSON.stringify(tmpl.tags),
        images: JSON.stringify([
          `https://picsum.photos/seed/${i + 1}/400/300`,
          `https://picsum.photos/seed/${i + 100}/400/300`,
        ]),
        sellerId: sellerIds[sellerIdx],
        sellerName: sellerNames[sellerIdx],
        sellerRating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
        stock: Math.floor(Math.random() * 50) + 5,
        status: 'active',
        viewCount,
        buyCount,
        region,
      },
    });

    // 리뷰 2~5개 추가
    const reviewCount = Math.floor(Math.random() * 4) + 2;
    for (let r = 0; r < reviewCount; r++) {
      const rv = reviewTemplates[Math.floor(Math.random() * reviewTemplates.length)];
      const reviewer = reviewerNames[Math.floor(Math.random() * reviewerNames.length)];
      const daysAgo = Math.floor(Math.random() * 60);
      await prisma.review.create({
        data: {
          productId: product.id,
          reviewerName: reviewer,
          rating: rv.rating,
          comment: rv.comment,
          helpful: Math.floor(Math.random() * 20),
          createdAt: new Date(Date.now() - daysAgo * 86400000),
        },
      });
    }

    createdProducts.push({ id: product.id, price, createdAt: product.createdAt });
    console.log(`  ✓ 상품 생성: ${product.title} (${price} ET)`);
  }

  console.log(`\n📈 가격 이력 30일치 생성 중...`);

  // 30일 가격 이력 생성
  for (const { id: productId, price: basePrice } of createdProducts) {
    let currentPrice = basePrice;

    for (let day = 30; day >= 0; day--) {
      const date = new Date(Date.now() - day * 86400000);
      // 랜덤 가격 변동 (-5% ~ +5%)
      const change = (Math.random() - 0.5) * 0.1 * currentPrice;
      currentPrice = Math.max(100, Math.round((currentPrice + change) / 100) * 100);

      await prisma.priceHistory.create({
        data: { productId, price: currentPrice, date },
      });
    }
  }

  console.log(`  ✓ ${createdProducts.length}개 상품 × 31일 = ${createdProducts.length * 31}개 가격 이력 생성`);

  // 판매자 신뢰도 계산
  console.log(`\n🏆 판매자 신뢰도 초기 데이터 생성...`);
  for (let i = 0; i < sellerIds.length; i++) {
    const sid = sellerIds[i];
    const sname = sellerNames[i];
    const score = Math.round(60 + Math.random() * 40);
    const badge = score >= 90 ? '다이아몬드' : score >= 75 ? '골드' : score >= 55 ? '실버' : '브론즈';

    await prisma.sellerReputation.upsert({
      where: { sellerId: sid },
      update: {
        sellerName: sname,
        completionRate: Math.round(70 + Math.random() * 30),
        avgRating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
        responseSpeed: Math.round(60 + Math.random() * 40),
        claimRate: Math.round(Math.random() * 10) / 100,
        activeDays: Math.floor(Math.random() * 365) + 30,
        totalScore: score,
        badge,
        updatedAt: new Date(),
      },
      create: {
        sellerId: sid,
        sellerName: sname,
        completionRate: Math.round(70 + Math.random() * 30),
        avgRating: Math.round((3.5 + Math.random() * 1.5) * 10) / 10,
        responseSpeed: Math.round(60 + Math.random() * 40),
        claimRate: Math.round(Math.random() * 10) / 100,
        activeDays: Math.floor(Math.random() * 365) + 30,
        totalScore: score,
        badge,
      },
    });
    console.log(`  ✓ 판매자 ${sname}: ${badge} (${score}점)`);
  }

  // 공동구매 몇 개 추가
  console.log(`\n⚡ 공동구매 데이터 생성...`);
  const gbProducts = createdProducts.slice(0, 10);
  for (const { id: productId, price } of gbProducts) {
    const discountRate = Math.floor(Math.random() * 25) + 5;
    const discountedPrice = Math.round(price * (1 - discountRate / 100) / 100) * 100;
    const targetCount = Math.floor(Math.random() * 30) + 5;
    const currentCount = Math.floor(Math.random() * targetCount);
    const hoursLeft = Math.floor(Math.random() * 120) + 12;

    await prisma.groupBuy.create({
      data: {
        productId,
        title: `인기 상품 공동구매 ${discountRate}% 할인`,
        description: `함께 구매하면 ${discountRate}% 더 저렴하게!`,
        targetCount,
        currentCount,
        discountRate,
        basePrice: price,
        discountedPrice,
        deadline: new Date(Date.now() + hoursLeft * 3600000),
        status: 'open',
        region: regions[Math.floor(Math.random() * regions.length)],
        budgetMin: 0,
        budgetMax: price * 1.2,
        matchScore: Math.round(Math.random() * 100),
      },
    });
  }

  const totalProducts = await prisma.product.count();
  const totalPriceHistory = await prisma.priceHistory.count();
  const totalGroupBuys = await prisma.groupBuy.count();
  const totalSellerRep = await prisma.sellerReputation.count();

  console.log(`\n✅ 시드 완료!`);
  console.log(`  상품: ${totalProducts}개`);
  console.log(`  가격 이력: ${totalPriceHistory}개`);
  console.log(`  공동구매: ${totalGroupBuys}개`);
  console.log(`  판매자 신뢰도: ${totalSellerRep}개`);
}

main()
  .catch(e => { console.error('시드 오류:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
