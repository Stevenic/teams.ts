export enum TokenValidationErrorCode {
  MISSING_TOKEN = 'missing_token',
  MALFORMED_TOKEN = 'malformed_token',
  EXPIRED_TOKEN = 'expired_token',
  FUTURE_TOKEN = 'future_token',
  INVALID_ISSUER = 'invalid_issuer',
  INVALID_AUDIENCE = 'invalid_audience',
  UNSUPPORTED_ALGORITHM = 'unsupported_algorithm',
  MISSING_KEY_ID = 'missing_key_id',
  KEY_NOT_FOUND = 'key_not_found',
  SIGNATURE_VERIFICATION_FAILED = 'signature_verification_failed',
  SERVICE_URL_MISMATCH = 'service_url_mismatch',
  MISSING_SERVICE_URL = 'missing_service_url',
  METADATA_RETRIEVAL_FAILED = 'metadata_retrieval_failed',
  JWKS_RETRIEVAL_FAILED = 'jwks_retrieval_failed',
}

export class TokenValidationError extends Error {
  public readonly code: TokenValidationErrorCode;

  constructor(code: TokenValidationErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'TokenValidationError';
  }
}

export class TokenFormatError extends TokenValidationError {
  constructor(code: TokenValidationErrorCode, message: string) {
    super(code, message);
    this.name = 'TokenFormatError';
  }
}

export class TokenClaimsError extends TokenValidationError {
  constructor(code: TokenValidationErrorCode, message: string) {
    super(code, message);
    this.name = 'TokenClaimsError';
  }
}

export class TokenAuthenticationError extends TokenValidationError {
  constructor(code: TokenValidationErrorCode, message: string) {
    super(code, message);
    this.name = 'TokenAuthenticationError';
  }
}

export class TokenInfrastructureError extends TokenValidationError {
  constructor(code: TokenValidationErrorCode, message: string) {
    super(code, message);
    this.name = 'TokenInfrastructureError';
  }
}

export interface IOpenIdMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  jwks_uri?: string;
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export interface IJwksKey {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  endorsements?: string[];
  n?: string; // RSA modulus
  e?: string; // RSA exponent
  [key: string]: unknown;
}

export interface IJwksResponse {
  keys: IJwksKey[];
}

// Extend JWT payload for Bot Framework specific claims
export interface IBotFrameworkJwtPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  serviceurl?: string;
  [key: string]: unknown;
}

