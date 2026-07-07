import { checkSellerMessageSafety } from '../../lib/safety/seller-safety-rules';

const cases = [
  { name: '처방약 거절', text: '처방약 남은 것 팔아요.', expectAllowed: false, expectFlag: 'prohibited_item' },
  { name: '무기 거절', text: '권총 부품 판매합니다.', expectAllowed: false, expectFlag: 'prohibited_item' },
  { name: '위조품 거절', text: '짝퉁 명품 지갑 팝니다.', expectAllowed: false, expectFlag: 'prohibited_item' },
  { name: '개인정보 보호', text: '010-1234-5678로 연락 주세요.', expectAllowed: false, expectFlag: 'sensitive_info' },
  { name: '일반 상품 허용', text: '중고 무선 이어폰 판매합니다.', expectAllowed: true, expectFlag: '' },
];

function allowedFromStatus(status: string) {
  return status === 'OK';
}

function main() {
  const results = cases.map((item) => {
    const decision = checkSellerMessageSafety(item.text);
    const allowed = allowedFromStatus(decision.status);
    const hasFlag = item.expectFlag ? decision.riskFlags.includes(item.expectFlag) : true;
    return {
      ...item,
      passed: allowed === item.expectAllowed && hasFlag,
      decision,
    };
  });
  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({ passed: failed.length === 0, results }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main();
