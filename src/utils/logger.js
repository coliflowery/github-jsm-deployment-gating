/**
 * Simple logger utility
 */

const logger = {
  info: (message) => {
    console.log(`[${new Date().toISOString()}] INFO: ${message}`);
  },

  warn: (message) => {
    console.log(`[${new Date().toISOString()}] WARN: ${message}`);
  },

  error: (message) => {
    console.log(`[${new Date().toISOString()}] ERROR: ${message}`);
  }
};

module.exports = { logger };
