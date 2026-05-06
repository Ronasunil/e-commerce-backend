import 'dotenv/config';

const required = (key, value) => {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

const parseBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
};

const parseInt10 = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const jwtSecret = required('JWT_SECRET', process.env.JWT_SECRET);
if (jwtSecret.length < 32) {
  throw new Error(
    `JWT_SECRET must be at least 32 characters (got ${jwtSecret.length})`,
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt10(process.env.PORT, 3000),
  mongoUri: required('MONGO_URI', process.env.MONGO_URI),
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bcryptRounds: parseInt10(process.env.BCRYPT_ROUNDS, 10),
  otp: {
    dummy: parseBool(process.env.OTP_DUMMY, true),
    expiryMin: parseInt10(process.env.OTP_EXPIRY_MIN, 10),
  },
  resetToken: {
    expiryMin: parseInt10(process.env.RESET_TOKEN_EXPIRY_MIN, 30),
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export const isProduction = config.nodeEnv === 'production';
export const isDevelopment = config.nodeEnv === 'development';

if (isProduction && config.otp.dummy) {
  console.warn(
    '[WARN] OTP_DUMMY=true in production. Anyone can verify any account by entering "1234". Set OTP_DUMMY=false and wire a real provider.',
  );
}
