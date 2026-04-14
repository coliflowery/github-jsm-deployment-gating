# Data Platform Pipeline Sync Failure - Root Cause Analysis

## Executive Summary

The pipeline sync failures are caused by **TWO critical issues**:

1. **PRIMARY ISSUE**: Stale token caching without refresh mechanism after GovCloud 2.0 credential rotation
2. **SECONDARY ISSUE**: Missing timeout configurations and improper retry logic

## Root Cause Analysis

### Issue #1: Authentication Token Mismatch (PRIMARY)

**Location**: `PipelineController.js:214` (validateAgencyToken method)

**Problem**: 
- The system caches agency tokens in memory (`tokenCache`)
- When GovCloud 2.0 rotated credentials on April 16, agencies started using new tokens
- Our cache still holds the OLD tokens, causing validation failures
- The code throws a 403 error immediately without attempting token refresh

**Evidence from Error Log**:
```
Expected: Bearer eyJhbGciOiJSUzI1NiJ9.dias...
Received: Bearer eyJhbGciOiJSUzI1NiJ9.agy_...
```

The token prefixes differ (`dias...` vs `agy_...`), indicating different token generations.

**Why Retries Failed**:
All 3 retry attempts used the SAME stale cached token, so all failed with identical authentication errors.

---

### Issue #2: Missing Timeout Configuration

**Locations**: 
- `PipelineController.js:65` (fetchAgencyToken)
- `DataSyncHandler.js:39` (process method)
- `DataSyncHandler.js:76` (executeSyncRequest)

**Problems**:

1. **No HTTP request timeout**: The axios call to fetch tokens has no timeout configured
   - If token service is slow/unresponsive, the request hangs indefinitely
   - This blocks the entire sync pipeline

2. **No overall sync operation timeout**: The `process()` method has no timeout
   - If an agency endpoint hangs, we wait forever
   - No circuit breaker to fail fast

3. **Fixed retry delays**: Using a constant 2-second delay between retries
   - Should use exponential backoff (2s, 4s, 8s)
   - Can overwhelm endpoints during outages

---

### Issue #3: Improper Retry Strategy

**Location**: `DataSyncHandler.js:26-42` (retry loop)

**Problems**:

1. **Retries ALL errors indiscriminately**: 
   - Authentication errors (403) should NOT be retried with the same token
   - Should attempt token refresh first
   - Only network/timeout errors should be retried

2. **No differentiation between error types**:
   - Permanent failures (401, 403) → Should refresh credentials or fail fast
   - Transient failures (500, 502, 503, 504, timeouts) → Should retry with backoff
   - Rate limiting (429) → Should use retry-after header

---

## Impact Assessment

- **18% failure rate** on agency data syncs
- **4,823 records** failed in single batch (MOH_PATIENT_AGGREGATE_20250417)
- Downstream analytics dashboards showing stale data
- Manual intervention required for re-ingestion
- Affects critical health data from Ministry of Health

---

## Question: Are We Handling Timeouts Correctly?

**ANSWER: NO**

### Timeout Issues Found:

1. ❌ **No HTTP request timeout** on token service calls
2. ❌ **No HTTP request timeout** on agency endpoint sync requests  
3. ❌ **No overall operation timeout** on sync jobs
4. ❌ **No circuit breaker** for repeatedly failing endpoints
5. ❌ **Fixed retry delay** instead of exponential backoff

### What Good Timeout Handling Looks Like:

```javascript
// ✅ HTTP request with timeout
await axios.get(url, {
  timeout: 5000, // 5 second timeout
  ...
});

// ✅ Overall operation timeout using Promise.race
const result = await Promise.race([
  executeSyncRequest(job),
  timeoutPromise(30000) // 30 second max for entire sync
]);

// ✅ Exponential backoff
const delay = baseDelay * Math.pow(2, attempt - 1);
await sleep(Math.min(delay, maxDelay));
```

---

## Recommended Fixes

### Priority 1: Fix Token Refresh Logic (CRITICAL)

1. Implement token refresh on 403 errors
2. Add token cache TTL (time-to-live)
3. Proactively refresh tokens before expiry
4. Subscribe to GovCloud credential rotation events

### Priority 2: Add Timeout Configurations (HIGH)

1. Add 5-second timeout to token service calls
2. Add 10-second timeout to agency endpoint sync requests
3. Add 30-second overall timeout for sync operations
4. Implement circuit breaker pattern for failing endpoints

### Priority 3: Improve Retry Strategy (HIGH)

1. Differentiate between error types (auth vs network vs transient)
2. Implement exponential backoff (2s, 4s, 8s, 16s)
3. Add max backoff ceiling (e.g., 30 seconds)
4. Only retry transient errors (5xx, network timeouts)
5. On auth errors, attempt token refresh ONCE before failing

### Priority 4: Add Monitoring & Alerting (MEDIUM)

1. Track token refresh events
2. Monitor sync failure rates by error type
3. Alert on elevated 403 errors (credential issues)
4. Track timeout occurrences

---

## Timeline Correlation

- **April 16**: GovCloud 2.0 credential rotation
- **April 17 09:14**: First failures appear in logs
- **Current**: ~18% failure rate stabilized

This timeline confirms the GovCloud credential update triggered the cascading failures.
