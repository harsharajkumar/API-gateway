/**
 * Logger Utility
 * Winston-based structured logging
 */

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logsDir = path.join(process.cwd(), 'logs');
const logToFiles = process.env.LOG_TO_FILES !== 'false';

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;

        if (Object.keys(metadata).length > 0) {
          msg += ` ${JSON.stringify(metadata)}`;
        }

        return msg;
      })
    )
  })
];

if (logToFiles) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });

    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error'
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log')
      })
    );
  } catch (error) {
    console.warn(`File logging disabled: ${error.message}`);
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'api-gateway' },
  transports
});

module.exports = logger;
