# NTUC Genie - Data Platform Pipeline Sync

## Overview

This repository contains the data platform pipeline sync system for NTUC Genie's inter-agency data integration.

## Recent Issue: Pipeline Sync Failures (April 17, 2025)

### Problem
18% of agency data syncs were failing with authentication errors after GovCloud 2.0 credential rotation on April 16.

### Root Cause
1. **Primary**: Stale token caching without refresh mechanism
2. **Secondary**: Missing timeout configurations and improper retry logic

### Solution
See [ANALYSIS.md](./ANALYSIS.md) for detailed root cause analysis and [FIXES_SUMMARY.md](./FIXES_SUMMARY.md) for implemented fixes.

## Key Files

### Original (Broken) Implementation
- `src/controllers/PipelineController.js` - Shows authentication token issue
- `src/handlers/DataSyncHandler.js` - Shows retry/timeout issues

### Fixed Implementation
- `src/controllers/PipelineController.fixed.js` - ✅ Token refresh + timeouts + circuit breaker
- `src/handlers/DataSyncHandler.fixed.js` - ✅ Intelligent retry + exponential backoff

### Documentation
- `ANALYSIS.md` - Detailed root cause analysis
- `FIXES_SUMMARY.md` - Summary of fixes and improvements

## Key Improvements

### 1. Token Management
- ✅ Automatic token refresh on mismatch
- ✅ Token cache with TTL (50 min for 60 min tokens)
- ✅ Proactive cache expiry

### 2. Timeout Configuration
- ✅ 5-second timeout on token service calls
- ✅ 10-second timeout on agency endpoint requests
- ✅ 30-second overall sync operation timeout

### 3. Retry Strategy
- ✅ Exponential backoff (2s → 4s → 8s)
- ✅ Error classification (don't retry auth errors)
- ✅ Jitter to prevent thundering herd

### 4. Circuit Breaker
- ✅ Opens after 5 consecutive failures
- ✅ 1-minute timeout before retry
- ✅ Prevents cascading failures

## Question Answered

**Q: Are we handling timeouts correctly in the sync pipeline?**

**A: NO** - The original implementation had:
- ❌ No HTTP request timeouts
- ❌ No overall operation timeouts
- ❌ Fixed retry delays instead of exponential backoff
- ❌ No circuit breaker

All issues have been fixed in the `.fixed.js` versions.

## Impact

### Before Fix
- 18% failure rate
- 4,823 records failed per batch
- Manual re-ingestion required
- Downstream dashboards showing stale data

### After Fix (Expected)
- <1% failure rate (only genuine errors)
- Automatic recovery from token rotation
- No indefinite hangs
- Self-healing system

## Related Slack Thread

See discussion: https://sdo-demo-9845.slack.com/archives/C0ASR67E729/p1776185594832039?thread_ts=1776185402.254689&cid=C0ASR67E729
