// Algorithm import removed - now using shared utility functions

import { Client, ILogger } from '@microsoft/teams.common';

import { CacheManager } from './cache-manager';
import { JwksKeyRetriever } from './jwks-key-retriever';
import { decodeJwt, isSupportedAlgorithm, validateTokenTime, verifyJwtSignature } from './jwt-utils';


const CACHE_TTL = 3600000; // 1 hour in milliseconds
const OPEN_ID_CONFIG_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const EXPECTED_ISSUER = 'https://api.botframework.com';
const EXPIRATION_BUFFER_SECONDS = 300; // 5 minutes buffer for expiration check

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

interface IOpenIdMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  jwks_uri?: string;
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export class ServiceTokenValidator {
  private readonly appId: string;
  private readonly logger?: ILogger;
  private readonly client: Client = new Client();
  private readonly metadataCache: CacheManager<IOpenIdMetadata>;
  private readonly keyRetriever: JwksKeyRetriever;

  constructor(appId: string, logger?: ILogger) {
    this.appId = appId;
    this.logger = logger;
    this.metadataCache = new CacheManager<IOpenIdMetadata>(CACHE_TTL);
    this.keyRetriever = new JwksKeyRetriever(CACHE_TTL);
  }

  async validateAccessToken(rawToken: string, serviceUrl?: string): Promise<void> {
    const decoded = decodeJwt(rawToken);
    if (!decoded.success) {
      this.logger?.error(decoded.error);
      throw new TokenValidationError(TokenValidationErrorCode.MISSING_TOKEN, decoded.error || 'No token provided');
    }

    const { header: unverifiedHeader, payload } = decoded.data;

    // Validate basic claims
    if (payload.iss !== EXPECTED_ISSUER) {
      this.logger?.error(`Invalid issuer: ${payload.iss}`);
      throw new TokenValidationError(TokenValidationErrorCode.INVALID_ISSUER, `Invalid issuer: ${payload.iss}`);
    }

    if (payload.aud !== this.appId) {
      this.logger?.error(`Invalid audience: ${payload.aud}`);
      throw new TokenValidationError(TokenValidationErrorCode.INVALID_AUDIENCE, `Invalid audience: ${payload.aud}`);
    }

    // Validate time claims
    const timeResult = validateTokenTime(payload, EXPIRATION_BUFFER_SECONDS);
    if (!timeResult.success) {
      this.logger?.error(timeResult.error);
      if (timeResult.error?.includes('missing expiration')) {
        throw new TokenValidationError(TokenValidationErrorCode.MALFORMED_TOKEN, timeResult.error);
      }
      if (timeResult.error?.includes('expired')) {
        throw new TokenValidationError(TokenValidationErrorCode.EXPIRED_TOKEN, timeResult.error);
      }
      if (timeResult.error?.includes('future')) {
        throw new TokenValidationError(TokenValidationErrorCode.FUTURE_TOKEN, timeResult.error);
      }
    }

    const algorithm = unverifiedHeader?.alg;
    if (!algorithm) {
      this.logger?.error('Token missing algorithm in header');
      throw new TokenValidationError(TokenValidationErrorCode.MALFORMED_TOKEN, 'Token missing algorithm in header');
    }

    if (!isSupportedAlgorithm(algorithm)) {
      this.logger?.error(`Unsupported algorithm: ${algorithm}`);
      throw new TokenValidationError(TokenValidationErrorCode.UNSUPPORTED_ALGORITHM, `Unsupported algorithm: ${algorithm}`);
    }

    const metadata = await this.getOpenIdMetadata();
    if (!metadata) {
      this.logger?.error('Failed to retrieve OpenID metadata for algorithm validation');
      throw new TokenValidationError(
        TokenValidationErrorCode.METADATA_RETRIEVAL_FAILED,
        'Failed to retrieve OpenID metadata'
      );
    }

    const supportedAlgorithms = metadata.id_token_signing_alg_values_supported;
    if (!supportedAlgorithms.includes(algorithm)) {
      this.logger?.error(`Token algorithm '${algorithm}' not in supported algorithms: ${supportedAlgorithms}`);
      throw new TokenValidationError(
        TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
        `Algorithm '${algorithm}' not supported`
      );
    }

    if (!unverifiedHeader.kid) {
      this.logger?.error('Token missing key ID (kid)');
      throw new TokenValidationError(TokenValidationErrorCode.MISSING_KEY_ID, 'Token missing key ID (kid)');
    }

    const keyResult = await this.keyRetriever.getPublicKey(unverifiedHeader.kid, metadata.jwks_uri!);
    if (!keyResult.success) {
      this.logger?.error(keyResult.error);
      throw new TokenValidationError(
        TokenValidationErrorCode.KEY_NOT_FOUND,
        keyResult.error || `Failed to get signing key for kid: ${unverifiedHeader.kid}`
      );
    }

    const verifyResult = verifyJwtSignature(rawToken, keyResult.data!, {
      algorithms: [algorithm],
      audience: this.appId,
      issuer: EXPECTED_ISSUER,
    });

    if (!verifyResult.success) {
      this.logger?.error(verifyResult.error);
      throw new TokenValidationError(
        TokenValidationErrorCode.SIGNATURE_VERIFICATION_FAILED,
        'Signature verification failed'
      );
    }

    const verifiedPayload = verifyResult.data;

    if (serviceUrl) {
      const tokenServiceUrl = verifiedPayload.serviceurl;

      if (!tokenServiceUrl) {
        this.logger?.error('Token missing serviceurl claim');
        throw new TokenValidationError(TokenValidationErrorCode.MISSING_SERVICE_URL, 'Token missing serviceurl claim');
      }

      const normalizedTokenUrl = tokenServiceUrl.replace(/\/$/, '').toLowerCase();
      const normalizedExpectedUrl = serviceUrl.replace(/\/$/, '').toLowerCase();

      if (normalizedTokenUrl !== normalizedExpectedUrl) {
        this.logger?.error(`Service URL mismatch. Token: ${normalizedTokenUrl}, Expected: ${normalizedExpectedUrl}`);
        throw new TokenValidationError(
          TokenValidationErrorCode.SERVICE_URL_MISMATCH,
          `Service URL mismatch. Token: ${normalizedTokenUrl}, Expected: ${normalizedExpectedUrl}`
        );
      }
    }

    this.logger?.debug('Service Framework token validation successful');
  }


  private async getOpenIdMetadata(): Promise<IOpenIdMetadata | null> {
    const cached = this.metadataCache.get();
    if (cached) {
      return cached;
    }

    try {
      const response = (await this.client.get<IOpenIdMetadata>(OPEN_ID_CONFIG_URL))?.data;

      this.metadataCache.set(response);

      this.logger?.debug(`Retrieved OpenID metadata from ${OPEN_ID_CONFIG_URL}`);
      return response;
    } catch (error) {
      this.logger?.error(`Failed to retrieve OpenID metadata: ${error}`);
      return null;
    }
  }
}