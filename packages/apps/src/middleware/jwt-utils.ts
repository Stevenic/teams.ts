import {
  Algorithm,
  decode,
  JwtHeader,
  JwtPayload,
  verify,
} from 'jsonwebtoken';

import { Result } from '../types/result';

export type JwtDecodeData = {
  header: JwtHeader;
  payload: JwtPayload;
};

export type JwtDecodeResult = Result<JwtDecodeData>;
export type JwtVerifyResult = Result<JwtPayload>;
export type TokenTimeValidationResult = Result<void>;

// https://github.com/auth0/node-jsonwebtoken#algorithms-supported
function isSupportedAlgorithm(value: string): value is Algorithm {
  const supportedAlgorithms: readonly string[] = [
    'HS256', 'HS384', 'HS512',
    'RS256', 'RS384', 'RS512',
    'ES256', 'ES384', 'ES512',
    'PS256', 'PS384', 'PS512',
    'none'
  ];
  return supportedAlgorithms.includes(value);
}

export function decodeJwt(rawToken: string): JwtDecodeResult {
  if (!rawToken) {
    return {
      success: false,
      error: 'No token provided',
    };
  }

  try {
    const decodedComplete = decode(rawToken, { complete: true });
    if (!decodedComplete || typeof decodedComplete === 'string') {
      return {
        success: false,
        error: 'Failed to decode token - invalid format',
      };
    }

    const { header, payload } = decodedComplete;

    if (!header || !payload || typeof payload !== 'object') {
      return {
        success: false,
        error: 'Failed to decode token',
      };
    }

    return {
      success: true,
      data: {
        header,
        payload,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Token malformed: ${error}`,
    };
  }
}

export function verifyJwtSignature(
  rawToken: string,
  publicKey: string,
  options?: {
    algorithms?: Algorithm[];
    audience?: string;
    issuer?: string;
  }
): JwtVerifyResult {
  try {
    const verifiedToken = verify(rawToken, publicKey, {
      complete: false,
      ...options,
    });

    if (typeof verifiedToken === 'string' || !verifiedToken) {
      return {
        success: false,
        error: 'Invalid token verification result',
      };
    }

    return {
      success: true,
      data: verifiedToken,
    };
  } catch (error) {
    return {
      success: false,
      error: `JWT signature verification failed: ${error}`,
    };
  }
}

export function validateTokenTime(
  payload: JwtPayload,
  bufferSeconds: number = 0
): TokenTimeValidationResult {
  if (!payload.exp) {
    return {
      success: false,
      error: 'Token missing expiration claim',
    };
  }

  const currentTime = Math.floor(Date.now() / 1000);

  if (currentTime > (payload.exp + bufferSeconds)) {
    return {
      success: false,
      error: 'Token is expired',
    };
  }

  if (payload.iat && (currentTime + bufferSeconds) < payload.iat) {
    return {
      success: false,
      error: 'Token issued in the future',
    };
  }

  return {
    success: true,
    data: undefined,
  };
}

export { isSupportedAlgorithm };
