const winston = require('winston');

// Tenta importar getRequestId (pode não estar disponível em boot)
let getRequestId;
try {
    ({ getRequestId } = require('../middlewares/request-id'));
} catch (e) {
    getRequestId = () => null;
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format((info) => {
            const requestId = getRequestId();
            if (requestId) {
                info.requestId = requestId;
            }
            return info;
        })(),
        winston.format.json()
    ),
    defaultMeta: { service: 'calisul-automation' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
                    const reqIdStr = requestId ? ` [${requestId.slice(0, 8)}]` : '';
                    const metaStr = Object.keys(meta).length > 1
                        ? ` ${JSON.stringify(meta, null, 0)}`
                        : '';
                    return `${timestamp} [${level}]${reqIdStr} ${message}${metaStr}`;
                })
            ),
        }),
    ],
});

module.exports = logger;

