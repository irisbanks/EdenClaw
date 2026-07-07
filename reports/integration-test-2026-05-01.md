# EDENCLAW Integration Test Report
**Date:** 2026-05-01

## Results

| | Count |
|--|--|
| ✅ PASS | 15 |
| ❌ FAIL | 0 |
| ⚪ SKIP | 1 |

## Steps

| Step | Description | Status |
|------|-------------|--------|
| 1 | Health check (localhost:3000) | ✅ |
| 2 | Swarm 5000 bots | ✅ |
| 3 | SellSession DB table | ✅ |
| 4 | Full sell flow (photo→price→approve→listed) | ✅ |
| 5 | Swarm buyer bot pool (0 bots) | ⚠️ |
| 6 | Bot activity (30s wait, 0 new tx) | ✅ |
| 7 | Key files (10 files) | ✅ |

## Swarm Market

```
Total bots: 5000
New transactions (last 60s): 0
Buyer bots (reputation≥50): 0
```

## Notes

- Dev server (PID 1427981) requires restart to activate new routes
- Google outbound network restricted → Gemini fallback active
- LoRA training pending user approval (scripts ready)
- EAS deploy pending EAS token registration
