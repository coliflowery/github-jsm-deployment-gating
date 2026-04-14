/**
 * DataSyncHandler - FIXED VERSION
 * Handles data synchronization with improved retry logic
 *
 * FIXES:
 * - Added overall timeout for sync operations
 * - Implemented exponential backoff for retries
 * - Differentiate between error types (don't retry auth errors)
 * - Added proper error classification
 */

const { PipelineController } = require('./PipelineController.fixed');
const { DataPlatformException } = require('../exceptions/DataPlatformException');
const { logger } = require('../utils/logger');

class DataSyncHandler {
  constructor(config) {
    this.config = config;
    this.pipelineController = new PipelineController(config);

    // Retry configuration
    this.maxRetries = 3;
    this.baseRetryDelay = 2000; // 2 seconds
    this.maxRetryDelay = 30000; // 30 seconds max

    // Timeout configuration
    this.syncOperationTimeout = 30000; // 30 seconds for entire sync operation
  }

  /**
   * Process data sync with improved retry logic
   * FIX: Added overall timeout and intelligent retry strategy
   */
  async process(syncJob) {
    const { jobId, agencyId, dataBatch, records } = syncJob;

    logger.info(`Starting sync job ${jobId} for agency ${agencyId}`);
    logger.info(`Data batch: ${dataBatch}, Records: ${records.length}`);

    try {
      // FIX: Wrap entire operation in timeout
      const result = await this.executeWithTimeout(
        () => this.processWithRetry(syncJob),
        this.syncOperationTimeout
      );

      logger.info(`Sync job ${jobId} completed successfully`);
      return result;

    } catch (error) {
      // Log detailed error information
      logger.error(`Max retries exceeded - sync job terminated`);
      logger.error(`Job ID: ${jobId}`);
      logger.error(`Affected agency: ${this.getAgencyName(agencyId)}`);
      logger.error(`Data batch: ${dataBatch}`);
      logger.error(`Records affected: ${records.length} rows`);
      logger.error(`Error: ${error.message}`);

      throw error;
    }
  }

  /**
   * Process with retry logic
   * FIX: Intelligent retry based on error type
   */
  async processWithRetry(syncJob) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.executeSyncRequest(syncJob);

        // Success! Reset any retry state
        if (attempt > 1) {
          logger.info(`Sync succeeded on attempt ${attempt}`);
        }

        return result;

      } catch (error) {
        lastError = error;

        // FIX: Classify error to determine if we should retry
        const errorType = this.classifyError(error);

        logger.warn(`Attempt ${attempt} of ${this.maxRetries} failed: ${error.message}`);
        logger.warn(`Error type: ${errorType}`);

        // FIX: Don't retry certain error types
        if (errorType === 'PERMANENT' || errorType === 'AUTH_FAILURE') {
          logger.error(`Non-retriable error detected (${errorType}) - aborting retries`);
          throw error;
        }

        // If we have retries left and error is retriable
        if (attempt < this.maxRetries && this.isRetriableError(errorType)) {
          // FIX: Exponential backoff with jitter
          const delay = this.calculateBackoffDelay(attempt);
          logger.info(`Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw lastError;
  }

  /**
   * Classify error type for retry decision
   * FIX: Proper error classification
   */
  classifyError(error) {
    if (error instanceof DataPlatformException) {
      const status = error.statusCode;

      // Authentication/Authorization errors - should not retry
      // (Token refresh is handled at a lower level)
      if (status === 401 || status === 403) {
        return 'AUTH_FAILURE';
      }

      // Client errors (400-499) - permanent failures
      if (status >= 400 && status < 500) {
        return 'PERMANENT';
      }

      // Server errors (500-599) - transient, retriable
      if (status >= 500 && status < 600) {
        return 'TRANSIENT';
      }

      // Timeout errors - retriable
      if (status === 504) {
        return 'TIMEOUT';
      }
    }

    // Network errors - retriable
    if (error.code === 'ECONNRESET' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND') {
      return 'NETWORK';
    }

    // Unknown errors - treat as transient
    return 'TRANSIENT';
  }

  /**
   * Check if error type is retriable
   */
  isRetriableError(errorType) {
    const retriableTypes = ['TRANSIENT', 'TIMEOUT', 'NETWORK'];
    return retriableTypes.includes(errorType);
  }

  /**
   * Calculate exponential backoff delay with jitter
   * FIX: Exponential backoff instead of fixed delay
   */
  calculateBackoffDelay(attempt) {
    // Exponential backoff: 2s, 4s, 8s, 16s, ...
    const exponentialDelay = this.baseRetryDelay * Math.pow(2, attempt - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.maxRetryDelay);

    // Add jitter (±20%) to prevent thundering herd
    const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
    const finalDelay = Math.round(cappedDelay + jitter);

    return finalDelay;
  }

  /**
   * Execute the actual sync request to agency endpoint
   * FIX: Added timeout parameter
   */
  async executeSyncRequest(syncJob) {
    const { agencyId, authToken, records } = syncJob;

    const request = {
      agencyId,
      authToken,
      data: records
    };

    // FIX: Pass timeout to controller (10 second HTTP timeout)
    return await this.pipelineController.processSyncRequest(request, 10000);
  }

  /**
   * Execute function with overall timeout
   * FIX: Added timeout wrapper for entire operation
   */
  async executeWithTimeout(fn, timeoutMs) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new DataPlatformException(
            `Sync operation exceeded timeout of ${timeoutMs}ms`,
            504
          ));
        }, timeoutMs);
      })
    ]);
  }

  /**
   * Get human-readable agency name
   */
  getAgencyName(agencyId) {
    const agencyMap = {
      'AGY_MOH_0042': 'Ministry of Health (MOH)',
      'AGY_MOE_0031': 'Ministry of Education (MOE)',
      'AGY_MOM_0015': 'Ministry of Manpower (MOM)'
    };
    return agencyMap[agencyId] || agencyId;
  }

  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { DataSyncHandler };
