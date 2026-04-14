/**
 * Custom exception for Data Platform errors
 */

class DataPlatformException extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'DataPlatformException';
    this.statusCode = statusCode;
    this.details = details;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details
    };
  }
}

module.exports = { DataPlatformException };
