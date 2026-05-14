import pino from 'pino';
import { config } from './config';

export const log = pino({
  level: config.logLevel,
  redact: {
    paths: ['password', 'token', 'privateKey', 'presharedKey', '*.password', '*.privateKey'],
    censor: '[redacted]',
  },
  base: { svc: 'varrok-edge' },
});
