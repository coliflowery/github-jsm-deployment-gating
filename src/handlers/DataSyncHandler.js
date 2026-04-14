/**
 * DataSyncHandler - Handles data synchronization with retry logic
 */

const { PipelineController } = require('../controllers/PipelineController');
const { logger } = require('../utils/logger');

class DataSyncHandler {
  constructor(config) {
    this.config = config;
    this.pipelineController = new PipelineController(config);
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds between retries
  }

  /**
   * Process data sync with retry logic
   * @param {Object} syncJob - The sync job containing agency data
   */
  async process(syncJob) {
    const { jobId, agencyId, dataBatch, records } = syncJob;

    logger.info(`Starting sync job ${jobId} for agency ${agencyId}`);
    logger.info(`Data batch: ${dataBatch}, Records: ${records.length}`);

    let lastError = null;

    // ISSUE #4: Retry logic retries on ALL errors, including authentication failures
    // We should NOT retry on 403 authentication errors - those need token refresh
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // ISSUE #5: No timeout on the entire sync operation
        // If the downstream endpoint hangs, we wait indefinitely
        const result = await this.executeSyncRequest(syncJob);

        logger.info(`Sync job ${jobId} completed successfully`);
        return result;

      } catch (error) {
        lastError = error;
        logger.warn(`Retry attempt ${attempt} of ${this.maxRetries} failed`);

        // ISSUE #6: We retry authentication errors without attempting token refresh
        // The error log shows 3 retries all failing with the same token mismatch
        if (attempt < this.maxRetries) {
          // ISSUE #7: Fixed retry delay doesn't use exponential backoff
          // This can overwhelm the endpoint during outages
          await this.sleep(this.retryDelay);
        }
      }
    }

    // All retries exhausted
    logger.error(`Max retries exceeded - sync job terminated`);
    logger.error(`Job ID: ${jobId}`);
    logger.error(`Affected agency: ${this.getAgencyName(agencyId)}`);
    logger.error(`Data batch: ${dataBatch}`);
    logger.error(`Records affected: ${records.length} rows`);

    throw lastError;
  }

  /**
   * Execute the actual sync request to agency endpoint
   * ISSUE #8: No timeout configured for HTTP request
   */
  async executeSyncRequest(syncJob) {
    const { agencyId, authToken, records } = syncJob;

    const request = {
      agencyId,
      authToken,
      data: records
    };

    // This is where the timeout should be, but it's missing
    // The request can hang indefinitely waiting for agency endpoint
    return await this.pipelineController.processSyncRequest(request);
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
