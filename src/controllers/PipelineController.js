/**
 * PipelineController - Handles data pipeline synchronization with agency endpoints
 */

const axios = require('axios');
const { DataPlatformException } = require('../exceptions/DataPlatformException');
const { logger } = require('../utils/logger');

class PipelineController {
  constructor(config) {
    this.config = config;
    this.agencyEndpoints = config.agencyEndpoints;
    this.tokenCache = new Map();
  }

  /**
   * Validates agency authentication token
   * @param {string} agencyId - The agency identifier
   * @param {string} receivedToken - Token received from agency
   * @returns {boolean} - Whether token is valid
   * @throws {DataPlatformException} - If token validation fails
   */
  async validateAgencyToken(agencyId, receivedToken) {
    try {
      // Get expected token from cache
      const expectedToken = this.tokenCache.get(agencyId);

      if (!expectedToken) {
        logger.warn(`No cached token found for agency: ${agencyId}`);
        // Fetch from token service
        const fetchedToken = await this.fetchAgencyToken(agencyId);
        this.tokenCache.set(agencyId, fetchedToken);
        return receivedToken === fetchedToken;
      }

      // ISSUE #1: Token comparison doesn't account for token rotation
      // The cache may contain an old token if GovCloud 2.0 rotated credentials
      // but we haven't refreshed our cache
      if (receivedToken !== expectedToken) {
        logger.error(`Token mismatch for agency ${agencyId}`);
        logger.error(`Expected: ${expectedToken}`);
        logger.error(`Received: ${receivedToken}`);

        // ISSUE #2: We throw immediately without attempting token refresh
        // This causes 403 errors even when the agency is using a valid rotated token
        throw new DataPlatformException(
          'Agency endpoint authentication mismatch',
          403,
          {
            agencyId,
            expectedToken: expectedToken.substring(0, 30) + '...',
            receivedToken: receivedToken.substring(0, 30) + '...'
          }
        );
      }

      return true;
    } catch (error) {
      if (error instanceof DataPlatformException) {
        throw error;
      }
      throw new DataPlatformException(
        `Token validation failed: ${error.message}`,
        500
      );
    }
  }

  /**
   * Fetches agency token from token service
   * ISSUE #3: No timeout configured - can hang indefinitely
   */
  async fetchAgencyToken(agencyId) {
    try {
      const response = await axios.get(
        `${this.config.tokenServiceUrl}/api/tokens/${agencyId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.serviceToken}`
          }
          // MISSING: timeout configuration
          // MISSING: retry logic for token service failures
        }
      );

      return response.data.token;
    } catch (error) {
      logger.error(`Failed to fetch token for ${agencyId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Refreshes token cache for an agency
   * This should be called when token mismatch is detected
   */
  async refreshAgencyToken(agencyId) {
    logger.info(`Refreshing token for agency: ${agencyId}`);
    this.tokenCache.delete(agencyId);
    return await this.fetchAgencyToken(agencyId);
  }

  /**
   * Process agency data sync request
   */
  async processSyncRequest(request) {
    const { agencyId, authToken, data } = request;

    // Validate token before processing
    await this.validateAgencyToken(agencyId, authToken);

    // Process the sync
    logger.info(`Processing sync for agency ${agencyId}`);
    return {
      status: 'success',
      recordsProcessed: data.length
    };
  }
}

module.exports = { PipelineController };
