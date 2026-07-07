import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
config({ path: '/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/.env' });
import { analyzePhoto } from '../lib/vision/photo-analyzer';

async function main() {
  const log: string[] = [];
  const ts = () => new Date().toISOString();

  log.push(`[${ts()}] test-photo-analyzer START`);
  log.push(`[${ts()}] Image: /tmp/test-shoe.jpg`);

  const imageBuffer = readFileSync('/tmp/test-shoe.jpg');
  const base64 = imageBuffer.toString('base64');
  log.push(`[${ts()}] Image size: ${imageBuffer.length} bytes`);

  try {
    const result = await analyzePhoto([{ base64, mimeType: 'image/jpeg', hint: '신발' }]);
    log.push(`[${ts()}] Gemini Vision response: OK`);
    log.push(`  category:       ${result.category}`);
    log.push(`  brand:          ${result.brand}`);
    log.push(`  color:          ${result.color}`);
    log.push(`  condition:      ${result.condition} (score: ${result.conditionScore})`);
    log.push(`  suggestedPrice: ${result.suggestedPrice.toLocaleString()}원`);
    log.push(`  priceRange:     ${result.minPrice.toLocaleString()}~${result.maxPrice.toLocaleString()}원`);
    log.push(`  description:    ${result.description}`);
    log.push(`  tags:           ${result.tags.join(', ')}`);
    log.push(`  confidence:     ${result.confidence}`);
    log.push(`  needsMorePhotos: ${result.needsMorePhotos}`);

    const requiredFields: (keyof typeof result)[] = ['category', 'brand', 'color', 'condition', 'suggestedPrice', 'description'];
    const missing = requiredFields.filter((f) => !result[f]);
    if (missing.length === 0) {
      log.push(`[${ts()}] PASS: All required fields present`);
    } else {
      log.push(`[${ts()}] WARN: Missing fields: ${missing.join(', ')}`);
    }
  } catch (err) {
    log.push(`[${ts()}] ERROR: ${String(err)}`);
  }

  log.push(`[${ts()}] test-photo-analyzer END`);

  const output = log.join('\n');
  console.log(output);

  writeFileSync('/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/logs/photo-analyzer-test.log', output + '\n');
}

main().catch(console.error);
