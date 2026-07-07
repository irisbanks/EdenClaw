import { runSandboxPaperTrading } from '../lib/agents/orchestrator/arbitrage-loop';

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const report = await runSandboxPaperTrading({
    capitalUsd: numberArg('capital', 10_000),
    maxProducts: numberArg('trades', 10),
    exchangeRateKrwPerUsd: numberArg('fx', 1380),
    importTaxRate: numberArg('tax', 0.15),
    minMarginPct: numberArg('min-margin', 7),
    useLiveAiVerification: flag('live-ai'),
    sandbox: true,
  });

  const tradeRows = report.trades.map((trade) => ({
    '#': trade.tradeNo,
    product: trade.product,
    source: trade.platform,
    cost: `$${trade.buyCostUsd.toFixed(2)}`,
    revenue: `$${trade.sellRevenueUsd.toFixed(2)}`,
    profit: `$${trade.netProfitUsd.toFixed(2)}`,
    margin: `${trade.marginPct.toFixed(2)}%`,
    capital: `$${trade.capitalAfterUsd.toFixed(2)}`,
    days: trade.deliveryDays,
    spec: trade.specScore,
    status: trade.status,
  }));

  console.log('\n===== EDENCLAW DEMAND-FIRST ARBITRAGE SANDBOX =====');
  console.table(tradeRows);
  console.log('\nSummary');
  console.log(JSON.stringify({
    mode: report.mode,
    startedCapitalUsd: report.startedCapitalUsd,
    finalCapitalUsd: report.finalCapitalUsd,
    netProfitUsd: report.netProfitUsd,
    roiPct: report.roiPct,
    tradesRequested: report.tradesRequested,
    tradesExecuted: report.tradesExecuted,
    assumptions: report.assumptions,
  }, null, 2));

  console.log('\nTop Opportunities');
  console.log(JSON.stringify(report.opportunities.map((opportunity) => ({
    product: opportunity.demand.name,
    demandScore: opportunity.demand.localDemandScore,
    supply: {
      platform: opportunity.bestSupply.platform,
      title: opportunity.bestSupply.title,
      deliveryDays: opportunity.bestSupply.deliveryDays,
      selectorStatus: opportunity.purchasePreparation.status,
    },
    verification: {
      model: opportunity.verification.model,
      score: opportunity.verification.score,
      passed: opportunity.verification.passed,
    },
    economics: {
      landedCostUsd: opportunity.costs.landedCostUsd,
      expectedRevenueUsd: opportunity.costs.expectedRevenueUsd,
      netProfitUsd: opportunity.costs.netProfitUsd,
      marginPct: opportunity.costs.marginPct,
    },
    listing: {
      platform: opportunity.listing.platform,
      title: opportunity.listing.title,
      price: opportunity.listing.price,
      tags: opportunity.listing.tags,
    },
    decision: opportunity.decision,
  })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
